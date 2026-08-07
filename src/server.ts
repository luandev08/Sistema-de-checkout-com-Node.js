import dotenv from "dotenv";
import express, { json, Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

dotenv.config();
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/webhook")) {
    // Captura QUALQUER tipo de conteúdo no webhook como Buffer bruto (RAW)
    express.raw({ type: "*/*" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

app.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // 1. Validação de segurança dos dados recebidos
  if (!req.body || (Buffer.isBuffer(req.body) && req.body.length === 0)) {
    console.error("❌ Erro: O corpo (payload) do Webhook veio vazio.");
    res.status(400).send("Webhook Error: No payload provided.");
    return;
  }

  if (!signature || !webhookSecret) {
    console.error("❌ Assinatura ou STRIPE_WEBHOOK_SECRET ausentes.");
    res.status(400).send("Webhook Error: Signature or secret missing.");
    return;
  }

  let event: Stripe.Event;

  try {
    // req.body aqui agora é um Buffer com o conteúdo completo enviado pelo Stripe / express.raw() n funciona nesta versão do node
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`❌ Erro na assinatura do Webhook: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const { produtoId, usuarioId } = session.metadata || {};
  // Se a assinatura passou, processa os eventos!
  switch (event.type) {
    case "checkout.session.completed": {
      console.log(`💳 Pagamento APROVADO! Sessão: ${session.id}`);

      if (produtoId && usuarioId) {
        try {
          const pedido = await prisma.pedido.create({
            data: {
              usuarioId,
              produtoId,
              stripeSessionId: session.id,
              status: "PAGO",
            },
          });

          const produtoAtualizado = await prisma.produto.updateMany({
            where: {
              id: produtoId,
              estoque: {
                gt: 0, //gt = greater than 0 > maior que 0 (concorrência de usuários pelo mesmo produto)
              },
            },
            data: { estoque: { decrement: 1 } },
          });

          if (produtoAtualizado.count === 0) {
            console.error(
              "❌ ESTOQUE ESGOTADO! O produto acabou antes do pagamento ser processado.",
            );
            await prisma.pedido.create({
              data: {
                usuarioId,
                produtoId,
                stripeSessionId: session.id,
                status: "SEM_ESTOQUE_CANCELADO",
              },
            });
          }

          console.log(`✅ Pedido ${pedido.id} salvo no banco!`);
        } catch (error) {
          console.error("❌ Erro no banco de dados:", error);
        }
      }
      break;
    }
    case "payment_intent.payment_failed":
      console.log("Saldo insuficiente!");
      await prisma.pedido.create({
        data: {
          usuarioId,
          produtoId,
          stripeSessionId: session.id,
          status: "CANCELADO",
        },
      });
      break;

    default:
      console.log(`ℹ️ Evento recebido: ${event.type}`);
  }

  res.status(200).json({ received: true });
});

app.post(
  "/create-checkout",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { produtoId, usuarioId } = req.body;

      if (!produtoId || !usuarioId) {
        res
          .status(400)
          .json({ error: "produtoId e usuarioId são obrigatórios." });
        return;
      }

      const produto = await prisma.produto.findUnique({
        where: { id: produtoId },
      });

      if (!produto || produto.estoque <= 0) {
        console.warn("Estoque do produto zerou durante sua sessão!.");
        res
          .status(400)
          .json({
            error: "Produto esgotado!",
            mensagem:
              "Lamentamos, mas este item não está mais disponível no estoque.",
          });
        return;
      }
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "brl",
              product_data: {
                name: "Dragon Slayer Vandal (Skin Rara)",
                description: "Edição Limitada de Colecionador",
              },
              unit_amount: 20000,
            },
            quantity: 1,
          },
        ],
        metadata: {
          produtoId: produtoId,
          usuarioId: usuarioId,
        },
        success_url: "http://localhost:3000/sucesso",
        cancel_url: "http://localhost:3000/cancelado",
      });

      res.json({ url: session.url });
      console.log("Url de Pagamento: ", session.url);
    } catch (error) {
      console.error("Error in checkout: ", error);
      res.status(500).json({ erro: "Failed to process payment" });
    }
  },
);

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Web rodando na porta: ${PORT}!`));
