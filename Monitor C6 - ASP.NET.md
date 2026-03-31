# Monitor C6 — ASP.NET Session Manager

> **Versão:** 12.0 · **Autor:** Guilherme · **Engine:** Tampermonkey (Chrome)
> **Target:** `https://c6.c6consig.com.br/*` (C6 Bank — plataforma FICSA)

---

## 1. Visão Geral

O **Monitor C6** é um UserScript que gerencia o acesso compartilhado a um sistema bancário legado (ASP.NET/FICSA) entre múltiplos operadores. Ele resolve um problema operacional: o sistema permite apenas **um usuário ativo por vez**, e não oferece controle nativo de fila ou notificação.

O script atua em três frentes:

- **Controle de sessão** — detecta automaticamente quando o operador está logado, registra entrada/saída e envia notificações para um canal do Discord via Webhook.
- **Sistema de fila** — gerencia uma fila de espera entre operadores usando o Supabase como backend em tempo real, com entrada manual e promoção automática.
- **Proteção contra falsos positivos** — diferencia navegação interna do ASP.NET (postbacks, botões customizados) do fechamento real da aba, evitando disparos incorretos do Webhook de saída.

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    NAVEGADOR (Chrome)                    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Tampermonkey (Isolated World)        │   │
│  │                                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │ Detector │  │ Sistema  │  │   Proteção     │  │   │
│  │  │ Presença │  │ de Fila  │  │  beforeunload  │  │   │
│  │  └─────┬────┘  └────┬─────┘  └───────┬────────┘  │   │
│  │        │             │                │            │   │
│  │        ▼             ▼                ▼            │   │
│  │  ┌─────────────────────────────────────────────┐  │   │
│  │  │               Badge UI (DOM)                │  │   │
│  │  └─────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌──────────────┐
     │  Discord   │ │  Supabase  │ │ Session      │
     │  Webhook   │ │  REST API  │ │ Storage      │
     └────────────┘ └────────────┘ └──────────────┘
```

---

## 3. Dependências Externas

| Serviço | Finalidade | Protocolo |
|---|---|---|
| **Discord Webhook** | Notificações de entrada/saída no canal da equipe | POST via `GM_xmlhttpRequest` ou `sendBeacon` |
| **Supabase** | Backend da fila de espera e controle de sessão ativa | REST API (`fetch`) |
| **Session Storage** | Persistência local do timestamp de início da sessão | API nativa do navegador |
| **Notification API** | Alerta desktop quando chega a vez do operador | API nativa do navegador |

---

## 4. Configuração

As constantes no topo do script devem ser editadas por operador:

| Constante | Descrição | Exemplo |
|---|---|---|
| `usuarioIDAlvo` | ID do operador no sistema FICSA (usado para detecção de login) | `"12391936966_004584"` |
| `nomeManual` | Nome de exibição do operador na fila e no Discord | `"Danilo"` |
| `webhookURL` | URL completa do Webhook do Discord (ou `"*"` para desativar) | `"https://discordapp.com/api/webhooks/..."` |
| `SUPABASE_URL` | URL do projeto Supabase | `"https://xxx.supabase.co"` |
| `SUPABASE_KEY` | Chave pública (anon) do Supabase | `"sb_publishable_..."` |
| `TOLERANCIA_SEGUNDOS` | Segundos de ausência tolerados antes de encerrar a sessão | `5` |

---

## 5. Máquina de Estados

O script opera com quatro estados locais, armazenados na variável `statusFila`:

```
                    ┌──────────────────────────────┐
                    │          AUSENTE              │
                    │  (Tela de login / Sem sessão) │
                    └──────┬──────────────┬────────┘
                           │              │
                  Fila vazia +         Clica em
                  sessão livre       "Entrar na Fila"
                           │              │
                           ▼              ▼
                    ┌────────────┐  ┌────────────┐
                    │  SUA_VEZ   │  │  ESPERA    │
                    │  (Pode     │  │  (Na fila, │
                    │   logar)   │◄─┤  aguarda)  │
                    └──────┬─────┘  └────────────┘
                           │
                     Faz login
                     com sucesso
                           │
                           ▼
                    ┌────────────┐
                    │  ONLINE    │
                    │  Logado    │
                    │  no sistema│
                    └──────┬─────┘
                           │
                  Fecha aba / Logout /
                  Tolerância excedida
                           │
                           ▼
                    ┌────────────┐
                    │  AUSENTE   │
                    └────────────┘
```

### Transições detalhadas

| De | Para | Gatilho |
|---|---|---|
| `ausente` | `sua_vez` | Loop de fila detecta que a sessão está livre e a fila vazia |
| `ausente` | `espera` | Operador clica em "Entrar na Fila" e já há alguém ativo |
| `espera` | `sua_vez` | Loop de fila detecta que o operador é o primeiro da fila e a sessão liberou |
| `sua_vez` | `online` | Operador faz login via `blindarFormularioLogin` e Supabase confirma |
| `sua_vez` | `ausente` | Outro operador assumiu a sessão enquanto aguardava |
| `online` | `ausente` | Fechamento de aba, logout, ou tolerância de ausência excedida |

---

## 6. Módulos Funcionais

### 6.1. Detecção de Presença (`monitorarPresenca`)

Executa a cada **1 segundo** via `setInterval`. Verifica se o operador está logado usando uma cadeia de heurísticas:

1. **Tela de login?** — Se `verificarSeEstaNaTelaLogin()` retorna `true`, não está logado.
2. **Session Storage** — Se existe a chave `c6_monitor_inicio`, assume logado.
3. **Script FICSA** — Procura `<script src="...fimenu...">` no DOM.
4. **Título da página** — Verifica se contém "Autorizador Web".
5. **ID do operador no DOM** — Busca o `usuarioIDAlvo` em spans da página.

Se detectar ausência enquanto `statusFila === "online"`, incrementa o `contadorAusencia`. Ao atingir `TOLERANCIA_SEGUNDOS` (5s), encerra a sessão automaticamente. Essa tolerância existe para absorver recargas rápidas de página que são comuns no ASP.NET.

### 6.2. Sistema de Fila (`loopAtualizarFila`)

Executa em loop assíncrono com intervalo de **5–7 segundos** (mais backoff exponencial em caso de falha). Consulta duas tabelas no Supabase:

- **`fila_espera`** — Lista ordenada de operadores aguardando.
- **`controle_sessao`** — Registro único (id=1) com o operador ativo.

A promoção na fila é automática: quando o primeiro da fila detecta que a sessão liberou, chama `tentarEntrar()` (RPC no Supabase) que é atômica — evita race conditions entre operadores.

### 6.3. Blindagem do Formulário de Login (`blindarFormularioLogin`)

Intercepta o botão "Entrar" (`lnkEntrar`) e a tecla Enter no campo de senha. Antes de permitir o postback nativo do ASP.NET, o script:

1. Bloqueia o evento original (`preventDefault` + `stopImmediatePropagation`).
2. Chama `tentarEntrar()` no Supabase para reservar a sessão.
3. Só libera o postback nativo se o Supabase confirmar com `"ENTROU"`.

Isso impede que um operador faça login sem estar na fila.

### 6.4. Webhook Discord (`enviarParaDiscord`)

Envia embeds formatados para o canal da equipe. Dois modos de envio:

- **Normal** (`GM_xmlhttpRequest`) — Usado durante a sessão, sem restrições de CORS.
- **Beacon** (`navigator.sendBeacon`) — Usado no `beforeunload`, pois é a única API garantida de funcionar durante o descarregamento da página. O payload é encapsulado em um `Blob` com `type: 'application/json'` porque o Discord rejeita o `Content-Type: text/plain` padrão do `sendBeacon`.

### 6.5. Badge UI (`renderizarVisualUnificado`)

Elemento `<div>` fixo no canto inferior direito da tela, atualizado via `requestAnimationFrame` (60fps). Exibe:

| Estado | Cor | Conteúdo |
|---|---|---|
| `online` | 🟢 Verde | Cronômetro da sessão (MM:SS) |
| `sua_vez` | 🟢 Verde pulsante | "SUA VEZ!" |
| `espera` | 🟠 Laranja pulsante | Posição na fila |
| `ausente` (verificando) | 🟡 Amarelo | Contador de tolerância |
| `ausente` (login) | 🔴 Vermelho | Botão "Entrar na Fila" |
| `ausente` (outro) | 🔴 Vermelho | "AUSENTE" |

Em todos os estados, exibe no rodapé o operador ativo e a fila de espera atual.

---

## 7. Proteção beforeunload — Lógica Invertida (v12)

Este é o módulo mais crítico do script. Resolve o problema dos falsos positivos em sites ASP.NET.

### 7.1. O Problema

O ASP.NET dispara `beforeunload` em praticamente toda navegação interna: postbacks de formulário, cliques em botões customizados (`Desabilitar_FIImageButton_Sem_Validacao`), dropdowns com `AutoPostBack`, etc. Não há como distinguir nativamente um postback de um fechamento de aba.

### 7.2. Tentativas Anteriores (e por que falharam)

As versões anteriores tentavam uma abordagem **whitelist** — interceptar cada função nativa do ASP.NET e levantar uma flag `blindagemAtiva`:

- **Sobrescrever `__doPostBack`** — Funcionava para postbacks padrão, mas não cobria botões customizados do FICSA.
- **Sobrescrever `Desabilitar_FIImageButton_Sem_Validacao`** — Falhava porque a função era definida dinamicamente pelo ASP.NET após o carregamento do script interceptor. O wrapper era aplicado sobre `undefined`.
- **`CustomEvent` cross-world** — O evento `NavegacaoInterna` precisava cruzar do main world para o isolated world do Tampermonkey, criar o listener, e setar a flag — tudo antes que o `beforeunload` disparasse. Uma race condition impossível de vencer em postbacks síncronos.

### 7.3. A Solução: Inversão de Lógica

Em vez de tentar marcar cada navegação interna, o script agora assume que **todo `beforeunload` é interno**, exceto quando não houve nenhuma interação recente na página.

A premissa é simples: quando o usuário fecha a aba pelo X do Chrome, ele **não interagiu com o DOM** nos segundos anteriores. Quando é uma navegação interna, sempre houve um clique, tecla ou submit imediatamente antes.

### 7.4. Variáveis de Controle

| Variável | Tipo | Descrição |
|---|---|---|
| `ultimaInteracaoPagina` | `number` | Timestamp (`Date.now()`) da última interação detectada |
| `clicouEmSair` | `boolean` | Flag explícita ativada ao clicar em "Sair" / "Logout" |
| `JANELA_INTERACAO_MS` | `number` | Milissegundos de tolerância (10.000ms = 10s) |

### 7.5. Eventos Capturados

Todos registrados na **fase de captura** (`true` no terceiro argumento do `addEventListener`), garantindo execução antes de qualquer handler inline do ASP.NET:

| Evento | Finalidade |
|---|---|
| `mousedown` | Clique físico do mouse (dispara antes do `click`) |
| `click` | Clique lógico (redundância) |
| `pointerdown` | Alternativa moderna ao `mousedown` |
| `touchstart` | Suporte a dispositivos touch |
| `keydown` | Teclas (Enter dispara postback, F5 dispara reload) |
| `submit` | Formulários submetidos |
| `change` | Dropdowns com `AutoPostBack` |

### 7.6. Fluxo de Decisão no `beforeunload`

```
beforeunload disparado
        │
        ▼
  clicouEmSair?  ──SIM──▶  ENVIA WEBHOOK (saída legítima)
        │
       NÃO
        │
        ▼
  Houve interação
  nos últimos 10s? ──SIM──▶  BLOQUEIA (navegação interna)
        │
       NÃO
        │
        ▼
  ENVIA WEBHOOK (fechou a aba pelo X)
```

### 7.7. Caso Especial: Botão "Sair"

O botão "Sair" é a exceção: é uma interação na página que **deve** disparar o Webhook. A função `registrarInteracao` detecta elementos com ID ou texto contendo "sair", "logout" ou "logoff" e ativa `clicouEmSair = true` sem atualizar o timestamp. Assim, o `beforeunload` subsequente passa direto pela verificação de interação recente.

### 7.8. Por que 10 Segundos?

A janela de 10 segundos (`JANELA_INTERACAO_MS = 10000`) é generosa intencionalmente. Em sistemas ASP.NET legados sobre conexões lentas, um postback pode levar vários segundos entre o clique e o `beforeunload`. Os 10 segundos cobrem até os piores cenários sem risco de falso negativo (um usuário dificilmente fecha a aba menos de 10 segundos após interagir com a página).

---

## 8. Loops e Timers

| Loop | Intervalo | Mecanismo |
|---|---|---|
| `monitorarPresenca` | 1s fixo | `setInterval` |
| `loopAtualizarFila` | 5–7s + backoff | `setTimeout` recursivo |
| `loopRenderizacao` | ~16ms (60fps) | `requestAnimationFrame` |

O `loopAtualizarFila` usa backoff exponencial em caso de falha de rede: `5000 + random(2000) + (2^falhas - 1) * 1000`, com cap em 6 falhas consecutivas (~69s de intervalo máximo).

---

## 9. Segurança

- **Sanitização HTML** — Todo texto exibido na badge passa por `sanitizarHTML()` para prevenir XSS via nomes de usuário maliciosos no Supabase.
- **Chave Supabase** — A chave utilizada é a `anon` (pública), adequada para operações client-side. O controle de acesso deve ser feito via Row Level Security (RLS) no Supabase.
- **Isolated World** — O script roda no mundo isolado do Tampermonkey, sem acesso direto às variáveis globais da página e vice-versa.

---

## 10. Limitações Conhecidas

1. **Fechamento rápido após interação** — Se o operador clicar em algo na página e fechar a aba em menos de 10 segundos, o Webhook de saída **não será enviado**. O `monitorarPresenca` detectará a ausência após `TOLERANCIA_SEGUNDOS` (5s) e finalizará a sessão pelo Supabase, mas sem Webhook para o Discord.

2. **`sendBeacon` não é 100% garantido** — Embora seja a melhor opção disponível, o `sendBeacon` pode falhar em cenários de crash do navegador ou kill forçado do processo. O sistema de tolerância do `monitorarPresenca` serve como rede de segurança.

3. **Sessão única por navegador** — O `sessionStorage` é por aba. Se o operador abrir múltiplas abas no mesmo site, cada uma terá sua própria instância do script, podendo gerar conflitos.

4. **Dependência de DOM** — A detecção de login depende de IDs e estruturas HTML específicas do FICSA (`ctl00_L_Usuario`, `EUsuario_CAMPO`, `lnkEntrar`). Atualizações no sistema podem quebrar essas heurísticas.

---

## 11. Tabelas Supabase Esperadas

### `controle_sessao`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `int` | Sempre `1` (registro único) |
| `ativo` | `boolean` | Se há um operador usando o sistema |
| `usuario_ativo` | `text` | Nome do operador ativo (ou `null`) |

### `fila_espera`

| Coluna | Tipo | Descrição |
|---|---|---|
| `usuario` | `text` | Nome do operador na fila |
| `entrou_em` | `timestamp` | Momento da entrada na fila (usado para ordenação) |

### RPC: `tentar_entrar(novo_usuario text)`

Função atômica que retorna:
- `"ENTROU"` — Sessão reservada com sucesso.
- `"FILA:N"` — Operador adicionado na posição N da fila.

---

## 12. Histórico de Versões

| Versão | Mudança Principal |
|---|---|
| 11.3 | Blindagem via interceptação de `__doPostBack` e `Desabilitar_FIImageButton_Sem_Validacao` |
| 11.6 | Hook em botões nativos do C6 via script injetado no main world |
| **12.0** | **Lógica invertida no `beforeunload`** — elimina race conditions e falsos positivos sem depender de interceptação de funções nativas |
