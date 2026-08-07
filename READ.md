# 💳 API de E-Commerce com Integração Stripe & Gestão de Estoque

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-darkblue.svg)](https://www.prisma.io/)
[![Stripe](https://img.shields.io/badge/Stripe-API-purple.svg)](https://stripe.com/)

Uma API RESTful robusta desenvolvida em Node.js e TypeScript para processamento de pagamentos via Stripe Checkout e Webhooks. O projeto conta com tratamento avançado de **concorrência de estoque (Race Conditions)** e validação em duas camadas para impedir vendas sem estoque.

---

## 🚀 Funcionalidades Principais

- **Checkout Dinâmico e Seguro:** Criação de sessões de pagamento no Stripe onde o preço e o nome do produto são buscados diretamente no Banco de Dados pelo `produtoId` (evitando manipulação de valores no client-side).
- **Proteção Contra Race Condition:** Uso de operações atômicas (`decrement`) no banco de dados e filtros relacionais para garantir a integridade do estoque quando múltiplos usuários compram simultaneamente.
- **Validação de Estoque em 2 Camadas:**
  1. _Camada 1 (Pre-checkout):_ Impede a geração do link de pagamento se o produto estiver esgotado.
  2. _Camada 2 (Webhook):_ Validação atômica no momento da confirmação do pagamento caso o item tenha esgotado durante a digitação do cartão.
- **Webhooks Seguros:** Processamento de eventos `checkout.session.completed` utilizando validação de assinatura criptográfica com o middleware `express.raw`.
- **Persistência de Dados:** Registro de pedidos associados ao ID nativo da sessão do Stripe (`stripeSessionId`) para rastreabilidade e idempotência.

---

## 🛠️ Tecnologias Utilizadas

- **Linguagem:** TypeScript / Node.js
- **Framework Web:** Express.js
- **ORM & Banco de Dados:** Prisma ORM & SQLite
- **Integração de Pagamentos:** Stripe API SDK & Stripe CLI
- **Execução:** TSX (`tsx watch`)

---

## 📦 Como Rodar o Projeto Localmente

### Pré-requisitos

- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) instalada para testes de webhooks locais

### 1. Clonar o repositório e instalar dependências

````bash
git clone [https://github.com/luandev08/Sistema-de-checkout-com-Node.js.git](https://github.com/luandev08/Sistema-de-checkout-com-Node.js.git)
cd Sistema-de-checkout-com-Node.js
npm install

## 🔄 Fluxo de Funcionamento e Arquitetura

```mermaid
sequenceDiagram
    autonumber
    actor Cliente
    participant Backend as API Express (Server)
    participant Banco as Banco de Dados (Prisma)
    participant Stripe as Stripe Gateway

    %% 1. Processo de Checkout
    rect rgb(240, 240, 255)
    Note over Cliente, Stripe: 1. Fase de Checkout (Pré-pagamento)
    Cliente->>Backend: POST /criar-checkout { produtoId, usuarioId }
    Backend->>Banco: Consulta produto por ID
    Banco-->>Backend: Retorna dados e estoque atual

    alt Estoque = 0
        Backend-->>Cliente: Retorna HTTP 400 (Produto Esgotado)
    else Estoque > 0
        Backend->>Stripe: Cria Checkout Session (Nome e Preço oficiais)
        Stripe-->>Backend: Retorna URL de pagamento
        Backend-->>Cliente: Retorna { url }
    end
    end

    %% 2. Processo de Pagamento e Webhook
    rect rgb(240, 255, 240)
    Note over Cliente, Stripe: 2. Fase de Confirmação (Webhook)
    Cliente->>Stripe: Finaliza pagamento no formulário
    Stripe->>Backend: POST /webhook (Evento: checkout.session.completed)

    Backend->>Backend: Valida assinatura com express.raw

    Backend->>Banco: UPDATE Produto SET estoque = estoque - 1 WHERE estoque > 0

    alt Sucesso no Update (Count > 0)
        Backend->>Banco: INSERT Pedido (status: "PAGO")
        Backend-->>Stripe: Retorna HTTP 200 OK
    else Falha no Update (Count = 0)
        Backend->>Banco: INSERT Pedido (status: "CANCELADO_SEM_ESTOQUE")
        Note over Backend: Alerta de estoque esgotado / Reembolso
        Backend-->>Stripe: Retorna HTTP 200 OK
    end
    end
````
