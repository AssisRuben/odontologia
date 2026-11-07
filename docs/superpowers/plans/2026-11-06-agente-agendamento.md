# Agente do WhatsApp — agendamento (etapa 6b): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agente do WhatsApp marca, remarca e desmarca consultas sozinho, oferecendo horários livres calculados pelo app a partir do horário de trabalho de cada profissional.

**Architecture:** Regras puras em `src/lib/agente/agendamento/**` (configuração, cálculo de horários, preferência, ofertas e textos). A IA (6a) ganha ações novas na saída estruturada; `executar.ts` executa cada ação com dependências injetadas; a gravação é a função SQL `book_whatsapp_appointment` (trava por profissional + checagem de conflito, transacional). `runAgent` despacha para `executar.ts` e envia o texto montado pelo app.

**Tech Stack:** Next.js 16 (route handlers), React 19, Supabase (Postgres, função SQL, advisory lock), Vitest, `openai` (via `src/lib/ia/openai.ts`), `zod` 4.

**Spec:** `docs/superpowers/specs/2026-11-06-agente-agendamento-design.md` (depende da 6a: `docs/superpowers/specs/2026-11-06-agente-whatsapp-design.md`)

## Global Constraints

- Next.js 16: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `page.md` antes de rotas/páginas.
- Rotas autenticadas com `withClinic` (`src/lib/ia/rotas.ts`); sempre filtrar por `clinic_id`; id não UUID → 422; de outra clínica → 404.
- **Só `src/lib/ia/openai.ts` importa `openai`.** Logs nunca contêm texto de mensagem, telefone, nome ou token.
- Limites (em `src/lib/agente/agendamento/limites.ts`, criado na Task 1): `MAX_OFFERS = 5`; `OFFER_TTL_MS = 2 * 3_600_000`; `MAX_PER_DAY = 2`; `MAX_SEARCHES_24H = 3`; `MAX_FUTURE_WA_APPOINTMENTS = 2`; apelidos `C1..C3` (as 3 próximas consultas `scheduled`/`confirmed`).
- Padrões: tipos `[{ nome: 'Avaliação', duracao_min: 30 }, { nome: 'Retorno', duracao_min: 30 }]` ativos para todos; `agendamento = { antecedencia_h: 24, dias_a_frente: 30, intervalo_min: 30 }`. Faixas: duração 15–240 múltiplo de 15; antecedência 0–168; dias 1–90; intervalo ∈ {15, 30, 60}; até 20 tipos; nome do tipo 1–60; até 2 períodos por dia.
- Manhã < 12:00; tarde 12:00–17:59; noite ≥ 18:00 (início do horário, fuso da clínica).
- Textos fixos (montados pelo app):
  - linha de oferta: `{n}) {ddd} {dd/mm} às {hora} com {profissional}` (ex.: `1) ter 11/11 às 8h30 com Dr. Carlos Mendes`; `ddd` = `dom seg ter qua qui sex sáb`; hora `8h30`, `10h`);
  - fecho da lista: `Qual prefere? Responda com o número.`;
  - relaxamento: `Não achei nesse dia ou período; estes são os mais próximos:`;
  - marcar: `Pronto! {tipo} marcada para {dia da semana por extenso}, {dd/mm}, às {hora} com {profissional}.` + ` Endereço: {endereço}.` se houver;
  - remarcar: `Pronto! Sua consulta foi remarcada para {dia da semana}, {dd/mm}, às {hora} com {profissional}.`;
  - desmarcar: `Consulta de {dd/mm} às {hora} desmarcada. Se quiser marcar outra data, é só pedir.`;
  - vencida: `Esses horários expiraram. Vou buscar de novo.`; ocupado: `Esse horário acabou de ser ocupado.`; nome: `Para marcar, preciso do seu nome completo.`
- Motivos de passagem: `'Tipo de consulta fora da lista'`, `'Muitas buscas de horário'`, `'Sem horário disponível'`, `'Limite de consultas pelo WhatsApp'`, `'Remarcação em cima da hora'`, `'Cancelamento em cima da hora'`, `'Agendamento para outra pessoa'`.
- Migração `supabase/2026-11-06-agente-agendamento.sql` re-executável, espelhada em `supabase/schema.sql`.
- Português do Brasil; estilo das telas atuais (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).

## Rulings sobre a spec

- **Rótulo na caixa de conversas:** nova coluna `messages.agent_action text null CHECK IN ('marcada','remarcada','desmarcada')`, gravada junto com `appointment_id` na mensagem do agente; o rótulo vem dela (a spec não dizia de onde viria o tipo da ação).
- **Nome do profissional nos textos:** nome completo como cadastrado (a spec mostrava "Dr. Carlos" só como exemplo).
- **Ordem em `marcar`:** a consulta é gravada antes de enviar a confirmação; se o envio falhar, a consulta fica e a conversa fica `unread` (a recepção vê na agenda).

## Review Focus

1. **Opção escolhida depois de vencida ou já ocupada** → busca de novo uma vez, sem gravar nada errado. → Task 4 (`opção vencida busca de novo`, `HORARIO_OCUPADO busca de novo uma vez`).
2. **"terça" pedido numa terça depois do expediente** → oferece a próxima terça, não horários passados. → Task 2 (`preferência de hoje depois do horário vai para a próxima semana`).
3. **Profissional com `working_hours` antigo/nulo ou dia sem período** → nenhum horário, sem erro. → Task 2 (`working_hours inválido não gera horários`).
4. **Remarcar uma C# que foi cancelada pela recepção nesse meio-tempo** → `CONSULTA_INVALIDA` → recepção, nada cancelado. → Task 4 (`remarcar consulta que mudou passa para a recepção`).
5. **Contato novo responde nome e opção na mesma mensagem** ("Maria Silva, a 2") → cria ficha e marca. → Task 4 (`contato novo com nome completo e opção marca`).

---

## File Structure

```
supabase/2026-11-06-agente-agendamento.sql            (novo) migração + função
supabase/schema.sql                                   (mod) espelho
src/types/index.ts                                    (mod) campos novos
src/lib/agente/config.ts                              (mod) tipos/agendamento no AgentConfig
src/lib/agente/agendamento/config.ts                  (novo) tipos, regras, working_hours (puro)
src/lib/agente/agendamento/limites.ts                 (novo) constantes de limites
src/lib/agente/agendamento/horarios.ts                (novo) calcularHorarios (puro)
src/lib/agente/agendamento/preferencia.ts             (novo) escolherOfertas (puro)
src/lib/agente/agendamento/ofertas.ts                 (novo) ofertas, apelidos, textos (puro)
src/lib/agente/agendamento/executar.ts                (novo) execução das ações
src/lib/agente/agendamento/repo.ts                    (novo) Supabase
src/lib/agente/esquema.ts, contexto.ts, agente.ts, repo.ts  (mod) integração
src/app/api/agente/config, testar                      (mod)
src/app/api/profissionais/[id]/agenda/route.ts        (novo)
src/app/(dashboard)/configuracoes/agente/page.tsx      (mod)
src/app/(dashboard)/configuracoes/profissionais/page.tsx (mod)
src/components/agenda/*, src/app/(dashboard)/pacientes/[id]/page.tsx, src/components/mensagens/ConversaPainel.tsx, src/app/api/conversas/[id]/route.ts (mod)
README.md                                             (mod)
```

### Task 1: Banco, tipos e configuração

**Files:**
- Create: `supabase/2026-11-06-agente-agendamento.sql`, `src/lib/agente/agendamento/config.ts`, `src/lib/agente/agendamento/limites.ts` (constantes de limites das Global Constraints)
- Modify: `supabase/schema.sql`, `src/types/index.ts`, `src/lib/agente/config.ts`
- Test: `tests/agente/agendamento/config.test.ts`, `tests/agente/config.test.ts`

**Interfaces:**
- Produces:
  - SQL (spec §Banco + ruling `agent_action`): colunas `professionals.whatsapp_booking`, `patients.source`, `appointments.source`, `conversations.offers`, `conversations.booking_draft`, `conversations.searches`, `messages.agent_action`; índice `appointments (professional_id, start_time)`; função `book_whatsapp_appointment(...)` exatamente como a spec (advisory lock `hashtext(p_professional_id::text)`, `RAISE EXCEPTION 'HORARIO_OCUPADO'` / `'CONSULTA_INVALIDA'`), `REVOKE` de `PUBLIC, anon, authenticated` e `GRANT EXECUTE ... TO service_role`.
  - `agendamento/config.ts`: `type TipoConsulta = { id: string; nome: string; duracao_min: number; profissionais: string[] | null; ativo: boolean }`; `type RegrasAgendamento = { antecedencia_h: number; dias_a_frente: number; intervalo_min: 15 | 30 | 60 }`; `type WorkingHours = Partial<Record<DayKey, [string, string][]>>`; `TIPOS_PADRAO`, `REGRAS_PADRAO`; `normalizeTipos(raw: unknown): TipoConsulta[]` (sem lista válida → `TIPOS_PADRAO` com ids estáveis `'avaliacao'`, `'retorno'`); `normalizeRegras(raw): RegrasAgendamento` (fora da faixa → padrão do campo); `normalizeWorkingHours(raw): WorkingHours` (descarta dia inválido, sobreposto, > 2 períodos, ordena); `validateTipos(raw): { ok: true; tipos } | { ok: false; error: string }` (erros `'Tipo de consulta inválido'`, `'Máximo de 20 tipos'`); `validateRegras(raw)` (erro `'Regras de agendamento inválidas'`); `validateWorkingHours(raw)` (erro `'Horário de trabalho inválido'`).
  - `AgentConfig` (6a) ganha `tipos: TipoConsulta[]` e `agendamento: RegrasAgendamento`, preenchidos por `normalizeAgentConfig` com as funções acima; `validateAgentConfig` valida também esses dois campos.
  - `types`: `Professional.whatsapp_booking: boolean`; `Patient.source: string | null`; `Appointment.source: string | null`; `Conversation` ganha `offers`, `booking_draft`, `searches`.
- [ ] **Step 1: Testes:** tipos padrão quando `null`; duração 20 → inválida; 21 tipos → `'Máximo de 20 tipos'`; regras `intervalo_min: 45` → padrão 30; `working_hours` `{ '1': [['08:00','12:00'],['11:00','13:00']] }` (sobreposto) → dia descartado; três períodos → descartado; formato antigo `{ '1': ['08:00','12:00'] }` → `{}`; `normalizeAgentConfig` de um objeto da 6a sem os campos novos → tipos e regras padrão.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(agendamento): migração, tipos e configuração`.

### Task 2: Cálculo de horários e preferência

**Files:**
- Create: `src/lib/agente/agendamento/horarios.ts`, `src/lib/agente/agendamento/preferencia.ts`
- Test: `tests/agente/agendamento/horarios.test.ts`, `tests/agente/agendamento/preferencia.test.ts`

**Interfaces:**
- Consumes: Task 1 (`WorkingHours`, `RegrasAgendamento`, `AgentConfig['hours']`).
- Produces:
  - `type ProfissionalAgenda = { id: string; nome: string; workingHours: WorkingHours }`; `type Ocupado = { professional_id: string; start: string; end: string }`; `type Candidato = { professional_id: string; professional_name: string; start: string; end: string }` (ISO UTC).
  - `calcularHorarios(args: { profissionais: ProfissionalAgenda[]; ocupados: Ocupado[]; clinicHours: AgentConfig['hours']; regras: RegrasAgendamento; duracaoMin: number; now: Date; timezone: string }): Candidato[]` — algoritmo da spec §calcularHorarios; dias de `hoje` a `hoje + dias_a_frente` no fuso; alinhamento: candidatos em múltiplos de `intervalo_min` contados a partir de 00:00 do dia; ordenado por início e nome. Usar `zonedDateTime`/`zonedParts` de `src/lib/messaging/time.ts`.
  - `type Preferencia = { dias_semana: number[] | null; periodo: 'manha' | 'tarde' | 'noite' | null; a_partir_de: string | null; profissional: string | null }`.
  - `escolherOfertas(candidatos: Candidato[], pref: Preferencia | null, timezone: string): { escolhidos: Candidato[]; relaxou: boolean }` — profissional (comparação sem acento, contém) filtra sempre; se não sobrar nenhum com o profissional → vazio; demais filtros relaxados na ordem período → dias → a partir de; até `MAX_OFFERS`, no máximo `MAX_PER_DAY` por dia, na ordem cronológica.
- [ ] **Step 1: Testes:** dois períodos 08–12 e 14–18 com duração 30 → primeiro 08:00, não há 12:00, há 14:00, último 17:30; duração 60 com intervalo 30 → último 17:00; clínica fechada no dia → nada; recorte pela clínica 09–17 sobre profissional 08–18; antecedência 24 h com `now` 10:00 → nada antes de amanhã 10:00; consulta 09:00–09:30 ocupa só 09:00; consulta `cancelled` não chega aos ocupados (responsabilidade do repo — testar no repo da Task 4) ; **`working_hours inválido não gera horários`** (`{}`); fuso: `now = 2026-11-07T02:30:00Z` (06/11 23:30 em SP) → primeiro dia considerado é 06/11 local; preferência `periodo: 'tarde'` filtra 12:00–17:59; `dias_semana: [2]` com só quarta livre → `relaxou: true`; profissional `'carlos'` casa `'Dr. Carlos Mendes'`; 3 horários no mesmo dia → só 2 escolhidos; **`preferência de hoje depois do horário vai para a próxima semana`** (`now` terça 19:00, `dias_semana: [2]` → primeira oferta na terça seguinte).
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(agendamento): cálculo de horários e preferência`.

### Task 3: Ofertas, textos, saída da IA e contexto

**Files:**
- Create: `src/lib/agente/agendamento/ofertas.ts`
- Modify: `src/lib/agente/esquema.ts`, `src/lib/agente/contexto.ts`
- Test: `tests/agente/agendamento/ofertas.test.ts`, `tests/agente/esquema.test.ts`, `tests/agente/contexto.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `ofertas.ts`: `type Oferta = Candidato & { n: number; tipo: string; expires_at: string }`; `criarOfertas(escolhidos: Candidato[], tipo: string, now: Date): Oferta[]`; `ofertaValida(ofertas: Oferta[], n: number, now: Date): Oferta | null`; `type ConsultaFutura = { id: string; start: string; procedure: string | null; professional: string | null }`; `apelidos(consultas: ConsultaFutura[]): { alias: 'C1' | 'C2' | 'C3'; consulta: ConsultaFutura }[]` (3 primeiras por início); `formatHora(d: Date, tz): string` (`8h30`, `10h`); `textoLista(ofertas, tz, relaxou: boolean): string`; `textoMarcada(o: Oferta, endereco: string | null, tz)`; `textoRemarcada(o, tz)`; `textoDesmarcada(c: ConsultaFutura, tz)` — todos com os textos exatos das Global Constraints.
  - `esquema.ts`: `AgentOutputSchema` com os campos da spec §Esquema (`tipo`, `preferencia`, `opcao`, `consulta`, todos anuláveis); `AgentDecision` ganha `{ acao: 'buscar_horarios'; resposta; tipo: string; preferencia: Preferencia | null; consulta: 'C1'|'C2'|'C3' | null }`, `{ acao: 'marcar'; resposta; opcao: number; nome: string | null }`, `{ acao: 'remarcar'; resposta; consulta; opcao: number | null }`, `{ acao: 'desmarcar'; resposta; consulta }`; `validateAgentOutput` com as regras da spec §Validação (`opcao` fora de 1..5 → `responder`; `consulta` inválida → `responder`; `buscar_horarios` sem `tipo` → `responder`; `dias_semana` só 0–6; `a_partir_de` só `YYYY-MM-DD` válida); `AGENT_SYSTEM` com os acréscimos da spec §Prompt (incluir literalmente "nunca escreva datas", "opcao", "nome completo", "outra pessoa") e removendo da 6a a instrução de passar agendamentos para a recepção.
  - `contexto.ts`: `AgentContextInput` ganha `tipos: { nome: string; duracao_min: number }[]`, `consultas: { alias: string; start: string; procedure: string | null; professional: string | null }[]` (substitui `nextAppointments`), `ofertas: Oferta[]`, `antecedenciaH: number`; linhas no formato da spec §Contexto; tipos vazios → `nenhum (não marque; passe para a recepção)`; ofertas vencidas não aparecem.
- [ ] **Step 1: Testes:** `formatHora` 08:30 → `8h30`, 10:00 → `10h`; `textoLista` com 2 ofertas igual ao texto exato; com `relaxou` começa com a frase de relaxamento; `textoMarcada` com e sem endereço; `ofertaValida` vencida → `null`, `n` 6 → `null`; `apelidos` de 4 consultas → 3; validação: `opcao: 7` → `responder`, `consulta: 'C9'` → `responder`, `buscar_horarios` sem tipo → `responder`, `dias_semana: [9]` descartado, `a_partir_de: '2026-02-30'` → `null`; prompt contém as frases; contexto lista tipos, C1..C3 e ofertas vigentes e não lista vencidas.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .` (ajustar `agente.ts`/`repo.ts` só no mínimo para compilar; a integração é da Task 5).
- [ ] **Step 5: Commit** `feat(agendamento): ofertas, textos e saída da IA`.

### Task 4: Execução das ações e repositório

**Files:**
- Create: `src/lib/agente/agendamento/executar.ts`, `src/lib/agente/agendamento/repo.ts`
- Test: `tests/agente/agendamento/executar.test.ts`, `tests/agente/agendamento/repo.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `interface AgendaDeps { carregar(clinicId: string, from: Date, to: Date): Promise<{ profissionais: (ProfissionalAgenda & { whatsappBooking: boolean })[]; ocupados: Ocupado[] }>; salvarEstado(conversationId: string, estado: { offers: Oferta[]; booking_draft: { tipo: string; replace_appointment_id: string | null } | null; searches: string[] }): Promise<void>; criarPaciente(clinicId: string, nome: string, phone: string): Promise<string>; ligarPaciente(conversationId: string, patientId: string): Promise<void>; contarFuturasWhatsapp(clinicId: string, patientId: string, now: Date): Promise<number>; gravar(args: { clinicId; patientId; professionalId; start; end; procedure; replaceId: string | null }): Promise<{ ok: true; id: string } | { ok: false; erro: 'HORARIO_OCUPADO' | 'CONSULTA_INVALIDA' }>; desmarcar(clinicId: string, patientId: string, appointmentId: string): Promise<boolean> }`.
  - `type EstadoConversa = { id; clinic_id; phone; patient_id: string | null; offers: Oferta[]; booking_draft: ...; searches: string[] }`; `type ContextoAgenda = { clinic: { address: string | null; timezone: string; hours: AgentConfig['hours']; tipos: TipoConsulta[]; regras: RegrasAgendamento }; consultas: { alias; consulta: ConsultaFutura }[] }`.
  - `type ResultadoAgenda = { texto: string; handoff: string | null; appointmentId: string | null; agentAction: 'marcada' | 'remarcada' | 'desmarcada' | null }`.
  - `executarAgenda(deps: AgendaDeps, conv: EstadoConversa, ctx: ContextoAgenda, d: Extract<AgentDecision, { acao: 'buscar_horarios' | 'marcar' | 'remarcar' | 'desmarcar' }>, now: Date): Promise<ResultadoAgenda>` — regras da spec §Execução; `texto` = `d.resposta` + `\n\n` + texto do app quando o app monta lista/confirmação; em passagem para a recepção `texto` = `d.resposta` e `handoff` = motivo; nova busca automática no máximo uma vez por execução.
  - `repo.ts`: `createAgendaDeps(admin): AgendaDeps` (`carregar`: profissionais da clínica com `whatsapp_booking` e `normalizeWorkingHours`, consultas do período com status fora de `cancelled`/`no_show`; `gravar`: RPC `book_whatsapp_appointment` mapeando `P0001` com mensagem `HORARIO_OCUPADO`/`CONSULTA_INVALIDA`; `desmarcar`: update `status='cancelled'` filtrando `id`, `clinic_id`, `patient_id`, `status in (scheduled, confirmed)`; `criarPaciente` com `source: 'whatsapp'`, `phone` e `whatsapp`).
- [ ] **Step 1: Testes** (deps falsas): busca grava 5 ofertas e `searches`, texto contém a lista; tipo fora da lista → handoff `'Tipo de consulta fora da lista'`; 4ª busca em 24 h → `'Muitas buscas de horário'`; sem horário → `'Sem horário disponível'`; **`opção vencida busca de novo`**; contato novo sem nome completo (`'Maria'`) → texto `Para marcar, preciso do seu nome completo.` e nada gravado; **`contato novo com nome completo e opção marca`** (cria ficha, liga conversa, grava, `agentAction: 'marcada'`); limite de 2 futuras → handoff; **`HORARIO_OCUPADO busca de novo uma vez`** (segunda vez → `'Sem horário disponível'`); remarcar sem opção guarda `replace_appointment_id` e busca; remarcar com opção chama `gravar` com `replaceId`; **`remarcar consulta que mudou passa para a recepção`** (`CONSULTA_INVALIDA`); remarcar/desmarcar dentro da antecedência → handoff; desmarcar ok → `agentAction: 'desmarcada'`. Repo: `carregar` não inclui `cancelled`/`no_show` (fakeSupabase de `tests/fakeSupabase.ts`); `gravar` mapeia `P0001`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(agendamento): execução das ações e repositório`.

### Task 5: Integração no `runAgent`

**Files:**
- Modify: `src/lib/agente/agente.ts`, `src/lib/agente/repo.ts`
- Test: `tests/agente/agente.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  - `AgentConversation` ganha `offers`, `booking_draft`, `searches`; `AgentDeps.nextAppointments` passa a devolver `ConsultaFutura[]` (`scheduled`/`confirmed`, futuras, até 3, com `id` e `procedure`); `AgentDeps.sendAgentMessage(conv, body, extra?: { appointmentId: string; agentAction: 'marcada' | 'remarcada' | 'desmarcada' })`; `AgentDeps.agenda: AgendaDeps`.
  - `runAgent`: contexto com tipos ativos, apelidos, ofertas vigentes e antecedência; depois das checagens pré-envio da 6a, ações de agenda chamam `executarAgenda` e enviam `resultado.texto` com `extra`; `handoff` → `setHandler('human', handoff)` e resultado `'handed_off'`; novos `AgentResult`: `'offered' | 'booked' | 'rescheduled' | 'cancelled_appt'`. Erro em `executarAgenda` → `fail()` (nada enviado).
  - `simulateAgent` devolve também `ofertas?: Oferta[]` quando a ação é `buscar_horarios` (calcula sem `salvarEstado`).
- [ ] **Step 1: Testes:** `buscar_horarios` envia o texto do app e devolve `'offered'`; `marcar` envia confirmação com `extra` e devolve `'booked'`; handoff de agenda chama `setHandler`; erro em `executarAgenda` não envia nada e marca `unread`; recepção assumindo durante a IA continua impedindo a execução da agenda (nenhuma chamada a `gravar`); `simulateAgent` com busca devolve ofertas e não chama `salvarEstado`/`gravar`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(agendamento): agente marca, remarca e desmarca`.

### Task 6: Rotas de configuração

**Files:**
- Create: `src/app/api/profissionais/[id]/agenda/route.ts`
- Modify: `src/app/api/agente/config/route.ts`, `src/app/api/agente/testar/route.ts`, `src/app/api/conversas/[id]/route.ts`
- Test: `tests/agente/agendamento/rotas.test.ts` (funções puras/injetadas extraídas para `src/lib/agente/agendamento/rotas.ts`)

**Interfaces:**
- Produces: `GET /api/agente/config` inclui `config.tipos`, `config.agendamento`, `profissionais: { id, name }[]` e `profissionaisWhatsApp: number`; `PUT` valida `tipos` (profissionais do tipo devem ser da clínica → senão 422 `'Tipo de consulta inválido'`) e `agendamento`; `PUT /api/profissionais/[id]/agenda { whatsapp_booking: boolean, working_hours }` → 422 `'Horário de trabalho inválido'`, 404 de outra clínica, 200 `{ ok: true }`; `POST /api/agente/testar` inclui `ofertas` (lista de `{ n, texto }`) quando houver; `GET /api/conversas/[id]` inclui `appointment_id` e `agent_action` em cada mensagem.
- [ ] **Step 1: Testes:** validação de tipos com profissional de outra clínica → 422; agenda do profissional de outra clínica → 404; `working_hours` inválido → 422.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(agendamento): rotas de configuração`.

### Task 7: Telas de configuração

**Files:**
- Modify: `src/app/(dashboard)/configuracoes/agente/page.tsx`, `src/app/(dashboard)/configuracoes/profissionais/page.tsx`

**Interfaces:**
- Consumes: rotas da Task 6.
- Produces: telas da spec §Telas (Agente: tipos, regras, aviso com link para `/configuracoes/profissionais`, ofertas no "Testar"; Profissionais: "Atende pelo WhatsApp", horário Seg→Dom com até 2 períodos, "Não atende", "Copiar segunda para os dias úteis", salvar por profissional via `PUT /api/profissionais/[id]/agenda`).
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .` e `npx eslint` nos arquivos; `curl` das páginas (307 para login, sem erro do servidor).
- [ ] **Step 2: Commit** `feat(agendamento): telas de configuração`.

### Task 8: Indicadores na agenda, ficha e conversa + README

**Files:**
- Modify: componentes da agenda que desenham a consulta e o detalhe (`src/components/agenda/CalendarioAgenda.tsx`, `PopoverConsulta.tsx`), `src/app/(dashboard)/pacientes/[id]/page.tsx`, `src/components/mensagens/ConversaPainel.tsx`, `README.md`

**Interfaces:**
- Consumes: `appointments.source`, `patients.source`, `messages.appointment_id/agent_action`.
- Produces: ícone `MessageCircle` (lucide) nas consultas `source = 'whatsapp'` e "Marcada pelo WhatsApp" no detalhe; etiqueta `Cadastrado pelo WhatsApp — complete CPF e dados no atendimento` quando `source = 'whatsapp'` e CPF vazio; rótulo `Consulta marcada` / `Consulta remarcada` / `Consulta desmarcada` nas mensagens com `agent_action`, link para `/agenda?data=YYYY-MM-DD` (se a agenda não aceitar `data` na URL, ler o parâmetro na página da agenda e abrir nessa semana); README: seção "Agendamento pelo agente" dentro da seção do agente (SQL antes do deploy, configurar profissionais e tipos, regras, o que não faz).
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos.
- [ ] **Step 2:** `npx vitest run`, `npx next build` (se o servidor de desenvolvimento atrapalhar, relatar BLOCKED sem matar processos).
- [ ] **Step 3: Commit** `feat(agendamento): indicadores e documentação`.
