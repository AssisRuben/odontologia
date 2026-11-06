# Evolução clínica e anamnese por voz (IA) — design

Item 5 do roteiro. Data: 2026-11-06. Branch: `feat/evolucao-por-voz`.

## Objetivo

O dentista fala em vez de digitar. O app transcreve, organiza o texto e sugere ações:

- **Parte 1 — evolução:** o texto vira uma evolução em seções, com sugestões já marcadas (concluir/iniciar item de orçamento aprovado, atualizar tratamento, lançar tratamento novo no odontograma, retorno). Um clique em "Salvar" grava tudo de uma vez.
- **Parte 2 — anamnese:** o texto preenche as perguntas do modelo de anamnese da clínica, só as que estão em branco, e acrescenta detalhes às Observações.

Sucesso: o dentista registra uma evolução completa (texto + odontograma + orçamento) falando e confirmando, sem digitar, e preenche uma anamnese a partir de uma conversa ou resumo ditado.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Escopo | Evolução com sugestões (opção B) + anamnese, num só projeto, evolução primeiro |
| Provedor de IA | **Só a OpenAI**: transcrição e organização. Uma chave, um contrato de dados |
| Ditado do aparelho | Botão **"Ditar"** no app (Web Speech API), além do "Gravar" (OpenAI) e de digitar |
| Chaves | **Cada clínica cadastra a sua**, guardada só no servidor, igual ao Asaas |
| Contexto da IA | Ficha resumida do paciente com apelidos curtos (O1, T2); sem nome, CPF, telefone |
| Sugestões | Vêm **já marcadas**; o botão mostra "Salvar e aplicar N sugestões" |
| Retorno | Não cria consulta; após salvar abre o agendamento com a data preenchida |
| IA chinesa | Descartada (dados de saúde em servidores na China; risco LGPD) |

## Modelos OpenAI (conferidos em 2026-11-06 na documentação oficial)

Ficam em **um único arquivo** (`src/lib/ia/modelos.ts`) para trocar com facilidade.

| Uso | Modelo | Preço |
|---|---|---|
| Transcrição | `gpt-transcribe` (`/v1/audio/transcriptions`, `languages: ['pt']`) | US$ 0,0045/min |
| Organizar — **econômico** (padrão) | `gpt-6-luna` | US$ 0,10 / 0,50 por MTok |
| Organizar — **caprichado** | `gpt-6.1-terra` | US$ 1 / 5 por MTok |

- `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` e `whisper-1` estão descontinuados (desligamento em 26/02/2027). Não usar.
- Áudio aceito: até 25 MB, formatos webm, mp4, m4a, mp3, wav. O iPhone (Safari) grava em mp4; Chrome/Android em webm.
- Saída estruturada: Responses API, `openai.responses.parse` com `zodTextFormat` (pacote `openai`, helper `openai/helpers/zod`; o projeto já usa `zod` 4). Todos os campos `required`, `additionalProperties: false`, opcionais como `["string","null"]`.
- Custo estimado por evolução (3 min de áudio + uma organização de ~4 mil tokens de entrada e ~1,5 mil de saída): transcrição ≈ US$ 0,014; organização ≈ US$ 0,001 (econômico) ou ≈ US$ 0,012 (caprichado).

## Arquitetura

```
Navegador                         Servidor (Next route handlers)            OpenAI
BarraVoz ── Gravar (MediaRecorder) ─► POST /api/ia/transcrever ──────────► gpt-transcribe
         ── Ditar (Web Speech, pt-BR, só local)
         ── texto
ModalEvolucao ─ Organizar ─────────► POST /api/ia/evolucao/organizar ────► gpt-6-luna|terra
              ─ Salvar ────────────► POST /api/evolucoes  ─► RPC save_evolution_with_actions
TabAnamneses ── Preencher com IA ──► POST /api/ia/anamnese/preencher ────► gpt-6-luna|terra
              ─ Salvar (como hoje, + ai_used)
Configurações → Inteligência artificial ─► GET/PUT/DELETE /api/ia/conexao
```

### Unidades (`src/lib/ia/`)

- `modelos.ts` — nomes dos modelos, preços para a estimativa, limites (`MAX_AUDIO_BYTES = 25 MB`, `MAX_AUDIO_SECONDS = 600`, `MAX_TEXT_CHARS = 20000`).
- `openai.ts` — **o único arquivo que fala com a OpenAI**: `transcribe(apiKey, audio)`, `organize(apiKey, model, schema, system, user)`, `testKey(apiKey)`. Erros mapeados para tipos do app (`invalid_key`, `rate_limited`, `unavailable`, `timeout`). Timeout de 60 s.
- `conexao.ts` + `repo.ts` — ler/salvar/remover a chave da clínica, teste ao salvar, resposta pública (só os 4 últimos dígitos), registrar uso.
- `uso.ts` — registro de uso e resumo do mês com custo estimado.
- `evolucao/ficha.ts` — monta a ficha resumida (apelidos ↔ UUIDs), sem dados pessoais.
- `evolucao/esquema.ts` — esquema zod da resposta e prompt do sistema.
- `evolucao/sugestoes.ts` — valida e traduz as sugestões de volta para UUIDs; descarta as inválidas.
- `anamnese/esquema.ts` + `anamnese/respostas.ts` — esquema/prompt e validação/mesclagem das respostas.

### Componentes (`src/components/ia/`)

- `BarraVoz.tsx` — "Gravar", "Ditar", aviso de tempo e estado; entrega texto ao campo do pai. "Gravar" só aparece com chave cadastrada; "Ditar" só aparece se o navegador tiver Web Speech API.
- `ListaSugestoes.tsx` — sugestões com caixas de marcar (já marcadas).

## Parte 1 — Evolução por voz

### Fluxo na tela ([ModalEvolucao.tsx](../../../src/components/agenda/ModalEvolucao.tsx))

1. **Texto**, de três formas que podem se misturar:
   - **Ditar**: `SpeechRecognition` com `lang = 'pt-BR'`, `continuous` e `interimResults`; o texto aparece enquanto o dentista fala e é acrescentado na posição do cursor. Se o reconhecimento parar sozinho (comum no iPhone), o botão volta ao estado "Ditar" sem perder o que já entrou.
   - **Gravar**: `MediaRecorder`; contador na tela; para sozinho em 10 min. Envia ao servidor, e o texto transcrito é acrescentado ao campo. O áudio não é salvo em lugar nenhum (nem no navegador depois do envio, nem no servidor).
   - **Digitar**.
2. **"Organizar com IA"** (precisa de chave e de texto): o resultado substitui o texto do campo e continua editável; botão **"Desfazer"** volta ao texto original.
3. **Sugestões** aparecem abaixo, **já marcadas**, com descrição legível (ex.: "Concluir *Restauração 36 MO* — orçamento de 12/10").
4. **"Salvar"** — rótulo "Salvar e aplicar N sugestões" quando N > 0. Grava tudo de uma vez.
5. Se houver retorno marcado, após salvar abre o agendamento (fluxo de nova consulta já existente) com a data sugerida preenchida e o motivo nas observações.

Fotos e histórico das últimas evoluções continuam como hoje. Sem chave: os botões de IA somem e a janela funciona como hoje (com "Ditar").

### Ficha resumida enviada à IA

Montada no servidor a partir do `patient_id`, sempre filtrada pela clínica do usuário:

- **Tratamentos** com status `planned` ou `in_progress`: apelido `T1..Tn`, procedimento, dentes e faces (`treatment_teeth`), status.
- **Itens de orçamentos `approved`** com `budget_items.approved = true` e status `pending` ou `in_progress`: apelido `O1..On`, procedimento, dente, status, data do orçamento.
- **Data de hoje** (fuso América/São Paulo).
- Nunca: nome, CPF, telefone, e-mail, endereço, data de nascimento. Idade e sexo também não vão.

Limite: no máximo 50 tratamentos e 50 itens (os mais recentes); o resto é omitido.

### Resposta da IA (esquema)

```ts
{
  secoes: {
    motivo: string | null,
    procedimentos: string | null,   // com dente e faces
    observacoes: string | null,
    proximos_passos: string | null,
  },
  sugestoes: Array<
    | { tipo: 'item_orcamento', ref: string /* O# */, novo_status: 'in_progress' | 'completed' }
    | { tipo: 'tratamento',     ref: string /* T# */, novo_status: 'in_progress' | 'completed' }
    | { tipo: 'tratamento_novo', procedimento: string, dentes: number[], faces: string[], status: 'completed' | 'planned' }
    | { tipo: 'retorno', dias: number /* 1..365 */, motivo: string }
  >
}
```

(No esquema estrito, a união vira um objeto com `tipo` em enum e os demais campos anuláveis; a validação do app garante a combinação certa por tipo.)

O texto final da evolução é montado pelo app, com títulos fixos: "Motivo", "Procedimentos realizados", "Observações", "Próximos passos" — seções nulas não aparecem.

O prompt do sistema instrui: português do Brasil, linguagem clínica objetiva, não inventar nada que não foi dito, usar apenas os apelidos da ficha, sugerir `tratamento_novo` só para procedimento realizado ou indicado que não está na ficha, numeração de dentes FDI (11–48, 51–85), faces entre `V M O D L` (as mesmas do odontograma).

### Validação das sugestões (servidor, antes de mostrar)

Descartar, sem erro para o usuário:
- `ref` que não existe na ficha, ou de tipo trocado (O# em `tratamento`);
- mudança que não avança o status (ex.: `completed` → `in_progress`; mesmo status);
- dentes fora da numeração FDI, faces fora da lista, procedimento vazio (corta em 200 caracteres);
- `dias` fora de 1..365; mais de um retorno (fica o primeiro);
- duplicadas (mesmo `ref`).

A resposta à tela leva as sugestões já traduzidas para UUIDs e com descrição pronta.

### Salvar — `POST /api/evolucoes`

Corpo: `patient_id`, `appointment_id?`, `date`, `description`, `images`, `ai_used`, `acoes[]` (sugestões marcadas, já com UUIDs). Chama a função SQL `save_evolution_with_actions` (SECURITY DEFINER, service role), que numa transação:

1. confere que paciente, consulta e cada item/tratamento pertencem à clínica **e** ao paciente;
2. confere que cada item/tratamento ainda está em aberto e que a mudança avança o status; se não, **aborta tudo** com erro legível ("O item Restauração 36 já foi concluído");
3. insere a evolução (`professional_id` da consulta, como hoje);
4. atualiza `budget_items.status`; ao concluir o último item aprovado de um orçamento, o orçamento vai para `completed` (respeitando os guardas do funil, com o modo de sistema já usado no item 4);
5. atualiza `treatments.status`;
6. insere tratamentos novos (`value = 0`, data da evolução, profissional da consulta) e os `treatment_teeth`.

Retorna o id da evolução. O retorno não é gravado no banco; volta para a tela, que abre o agendamento.

A janela passa a salvar sempre por essa rota (com ou sem IA), para ter um caminho só.

## Parte 2 — Anamnese por voz

### Fluxo na tela ([TabAnamneses.tsx](../../../src/components/paciente/TabAnamneses.tsx))

No topo do formulário: a mesma `BarraVoz` e um campo de texto. Botão **"Preencher com IA"**.

- O servidor envia o texto e as perguntas do modelo escolhido (`id`, `text`, `type`, `options`). Nada do paciente.
- A IA devolve `respostas: Array<{ id: string, valor: string | null }>` e `observacoes: string | null`.
- Regras por tipo (validadas no servidor):
  - `yesno`: só `"Sim"` ou `"Não"` (aceita variações como "sim", "nao" e normaliza);
  - `options`: precisa bater com uma das opções cadastradas (comparação sem acento/maiúscula; grava a grafia cadastrada); senão, ignora;
  - `text`: até 500 caracteres;
  - `id` desconhecido ou `null` → ignora (fica em branco; a IA não chuta).
- Detalhes vão para `observacoes` (ex.: "Alergia: penicilina"; "Medicação: losartana 50 mg").

### Mesclagem na tela

- Só preenche perguntas **em branco**; respostas já marcadas à mão não mudam.
- Observações: o texto da IA é **acrescentado** ao existente, numa linha nova.
- Cada resposta vinda da IA mostra uma marca **"IA"**, que some se o dentista mexer nela.
- Salvar como hoje, mais `anamneses.ai_used = true` quando a IA preencheu algo.

## Configurações → "Inteligência artificial"

Página nova em `src/app/(dashboard)/configuracoes/ia/`, no menu de configurações.

- Campo **chave da OpenAI**; ao salvar, o servidor testa a chave (`testKey`, chamada barata de listagem de modelos) e só aceita se funcionar. Mostra só `sk-…abcd`. Botão "Remover".
- **Modelo para organizar:** "Econômico" (padrão) ou "Mais caprichado".
- **Uso do mês:** minutos de áudio, organizações de evolução, preenchimentos de anamnese e custo estimado em US$.
- Aviso curto de LGPD: a API da OpenAI não usa os dados para treinar; a clínica deve aceitar o contrato de tratamento de dados (DPA) na conta dela.
- Qualquer usuário da clínica altera e usa (o app não tem papéis de usuário hoje; mesma regra das outras configurações).

## Banco (`supabase/2026-11-06-evolucao-por-voz.sql`, espelhado em `schema.sql`)

```sql
CREATE TABLE ai_connections (
  clinic_id    UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'openai',
  api_key      TEXT NOT NULL,
  api_key_last4 TEXT NOT NULL,
  model_tier   TEXT NOT NULL DEFAULT 'economico' CHECK (model_tier IN ('economico','caprichado')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ai_connections ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role

CREATE TABLE ai_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id       UUID,
  kind          TEXT NOT NULL CHECK (kind IN ('transcricao','evolucao','anamnese')),
  model         TEXT NOT NULL,
  audio_seconds INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  ok            BOOLEAN NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON ai_usage (clinic_id, created_at);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role

ALTER TABLE evolutions ADD COLUMN ai_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE anamneses  ADD COLUMN ai_used BOOLEAN NOT NULL DEFAULT FALSE;
-- + função save_evolution_with_actions(...) (SECURITY DEFINER, EXECUTE só para service_role)
```

`ai_usage` nunca guarda texto, áudio ou dado do paciente.

## Rotas

Todas com `getCurrentClinic()` (sessão + clínica), `dynamic = 'force-dynamic'`, respostas de erro em português, ids validados como UUID (422, não 500).

| Rota | Entrada | Saída / regras |
|---|---|---|
| `GET /api/ia/conexao` | — | `{ conectado, last4, modelTier, usoMes }` |
| `PUT /api/ia/conexao` | `{ apiKey?, modelTier? }` | testa a chave nova; 422 "Chave inválida" |
| `DELETE /api/ia/conexao` | — | remove a chave |
| `POST /api/ia/transcrever` | multipart `audio` + `seconds` | 413 se > 25 MB ou > 600 s; tipo precisa ser de áudio; `{ texto }` |
| `POST /api/ia/evolucao/organizar` | `{ patientId, texto }` | 422 se texto vazio ou > 20.000; `{ texto, secoes, sugestoes }` |
| `POST /api/ia/anamnese/preencher` | `{ templateId, texto }` | modelo da clínica; `{ respostas, observacoes }` |
| `POST /api/evolucoes` | ver "Salvar" | `{ id }`; 409 com mensagem quando uma ação ficou inválida |

Sem chave cadastrada: 409 `{ error: 'Cadastre a chave da OpenAI em Configurações → Inteligência artificial' }`.

## Erros

| Situação | Mensagem na tela | Efeito |
|---|---|---|
| Chave recusada pela OpenAI | "A chave da OpenAI foi recusada. Confira em Configurações." | texto preservado |
| Limite/saldo da conta OpenAI | "A conta da OpenAI atingiu o limite. Tente mais tarde." | idem |
| Serviço fora / tempo esgotado (60 s) | "Não foi possível organizar agora. Tente de novo." | idem |
| Microfone negado | "Permita o uso do microfone no navegador." | — |
| Áudio longo demais | gravação para em 10 min e envia o que tem | — |
| Resposta da IA fora do esquema | igual a "serviço fora" | registrado em `ai_usage` com `ok = false` |

Em qualquer erro de IA, o dentista ainda salva a evolução ou a anamnese manualmente. Logs do servidor nunca incluem chave, texto ou áudio.

## LGPD e segurança

- Dados de saúde: só o texto do atendimento e a ficha resumida sem identificação saem para a OpenAI.
- Áudio só em memória, descartado após a transcrição.
- A chave nunca vai ao navegador, nunca aparece em log, e a tabela não tem policy (só service role).
- A política de privacidade/termo da clínica deve mencionar o uso de IA — fica como orientação no README, não como recurso do app.

## Testes

Automáticos (Vitest, padrão atual, OpenAI simulada por injeção de dependências):
- `ficha`: sem dados pessoais; apelidos estáveis; só itens em aberto da clínica e do paciente; limite de 50.
- `sugestoes`: descarta ref inexistente, tipo trocado, status que não avança, dentes/faces inválidos, `dias` fora do intervalo, duplicadas; traduz apelidos para UUID; monta descrição legível.
- `evolucao/esquema`: montagem do texto final com títulos e seções nulas omitidas.
- `anamnese/respostas`: normaliza Sim/Não, opção fora da lista ignorada, grafia cadastrada, não sobrescreve, observações acrescentadas.
- `openai`: mapeamento de erros (401 → `invalid_key`, 429 → `rate_limited`, timeout).
- `conexao`: chave inválida não é salva; resposta pública só com last4; troca de modelo.
- `uso`: resumo do mês e custo estimado.
- Rotas: sem sessão 401; sem chave 409; limites 413/422; UUID inválido 422.
- `save_evolution_with_actions`: testado pelos testes do wrapper (regras de validação replicadas em TS) e no teste manual; a função SQL aborta tudo se uma ação for inválida.

Manual, com o usuário: gravar e ditar no iPhone e no computador; organizar; salvar; conferir odontograma, orçamento (item concluído e orçamento concluído no último item), abertura do agendamento com a data; anamnese preenchida sem sobrescrever; configurações (chave inválida recusada, uso do mês).

## Fora do escopo

- Guardar o áudio.
- Gravar a consulta inteira com várias pessoas falando (separação de vozes).
- A IA criar a consulta de retorno sozinha.
- Alertas automáticos de risco (alergia, anticoagulante).
- Outros provedores de IA (o arquivo `openai.ts` isolado deixa a porta aberta).
