# Agente de IA no WhatsApp — etapa 6b (agendamento) — design

Item 6 do roteiro, segunda etapa. Data: 2026-11-06. Branch: `feat/agente-agendamento`. Depende da etapa 6a (`docs/superpowers/specs/2026-11-06-agente-whatsapp-design.md`), já na `main`.

## Objetivo

O agente do WhatsApp passa a **marcar, remarcar e desmarcar consultas** sozinho, com horários calculados pelo app a partir do horário de trabalho de cada profissional e das consultas já marcadas.

Sucesso: um paciente pede "uma avaliação terça de manhã", recebe até 5 opções reais, responde "a 2" e a consulta aparece na agenda, sem passar pela recepção. Remarcar e desmarcar funcionam do mesmo jeito, respeitando a antecedência mínima. Nenhuma consulta é gravada em horário ocupado nem fora do horário do profissional.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Confirmação | **Direto na agenda** (status `scheduled`), sem aprovação da recepção |
| Contato novo | O agente pede o nome completo, **cria a ficha** (nome + telefone, `source = 'whatsapp'`) e marca |
| Disponibilidade | **Horário de trabalho por profissional** + "Atende pelo WhatsApp"; livre = dentro do horário, sem consulta ativa sobreposta |
| Tipos | **Lista configurável** de tipos com duração e profissionais; fora da lista → recepção |
| Remarcar/desmarcar | Pelo agente, respeitando **antecedência mínima** (padrão 24 h); dentro dela → recepção. A mesma antecedência vale para marcar |
| Abordagem | **Ofertas guardadas pelo app**: a IA escolhe ações; o app calcula, lista e grava; a IA só aponta o número da opção |

## Arquitetura

Continua o fluxo da 6a (`runAgent`). A saída estruturada ganha ações novas; o app executa cada uma com regras puras e uma função SQL transacional.

```
runAgent
 ├─ contexto (6a) + tipos de consulta + próximas consultas com apelidos (C1..C3) + ofertas vigentes (1..5)
 ├─ IA → { acao, resposta, nome?, motivo?, tipo?, profissional?, preferencia?, opcao?, consulta? }
 ├─ buscar_horarios → calcularHorarios() → até 5 ofertas → grava em conversations.offers → app monta a lista
 ├─ marcar          → oferta válida? → (contato novo: cria ficha) → book_whatsapp_appointment() → app monta confirmação
 ├─ remarcar        → consulta C# + oferta → book_whatsapp_appointment(p_replace_id) → confirmação
 └─ desmarcar       → consulta C# + antecedência → cancel → confirmação
```

### Unidades novas (`src/lib/agente/agendamento/`)

| Arquivo | Responsabilidade |
|---|---|
| `config.ts` | Normaliza/valida `agent_config.tipos` e `agent_config.agendamento`; normaliza `working_hours` |
| `horarios.ts` | `calcularHorarios(...)` — puro: horários livres por profissional e dia |
| `preferencia.ts` | Filtra/ordena candidatos pela preferência (dias da semana, manhã/tarde/noite, data a partir de) |
| `ofertas.ts` | Monta ofertas (até 5, validade 2 h), textos da lista e das confirmações, apelidos `C1..C3` das consultas futuras |
| `executar.ts` | Executa as ações novas com dependências injetadas |
| `repo.ts` | Supabase: profissionais, consultas do período, RPC de gravação, criação de ficha |

Mudanças em unidades da 6a: `esquema.ts` (schema/prompt/validação), `contexto.ts` (tipos, consultas com apelido, ofertas), `agente.ts` (despacho para `executar.ts`), `config.ts` do agente (normalização dos campos novos).

## Banco (`supabase/2026-11-06-agente-agendamento.sql`, espelhado em `schema.sql`)

- `professionals.whatsapp_booking boolean not null default false`.
- `professionals.working_hours` passa a ter o formato `{ "0".."6": [["HH:MM","HH:MM"], ...] }` (até 2 períodos por dia; dia ausente = não atende). Valores antigos em outro formato são ignorados pela normalização.
- `patients.source text null` (`'whatsapp'` quando criado pelo agente).
- `appointments.source text null` (`'whatsapp'` quando marcado pelo agente).
- `conversations.offers jsonb not null default '[]'` — `[{ n, professional_id, professional_name, start, end, tipo, expires_at }]`.
- `conversations.booking_draft jsonb null` — `{ tipo, replace_appointment_id? }` (consulta a remarcar escolhida antes da busca).
- `conversations.searches jsonb not null default '[]'` — instantes das buscas (limite de 3 por 24 h).
- `agent_config` ganha:
  - `tipos`: `[{ id, nome, duracao_min, profissionais: string[] | null, ativo }]`; padrão `[{Avaliação,30},{Retorno,30}]` (ativos, todos os profissionais).
  - `agendamento`: `{ antecedencia_h: 24, dias_a_frente: 30, intervalo_min: 30 }`.
- Índice `appointments (professional_id, start_time)`.

### Função `book_whatsapp_appointment`

```
book_whatsapp_appointment(p_clinic_id uuid, p_patient_id uuid, p_professional_id uuid,
                          p_start timestamptz, p_end timestamptz, p_procedure text,
                          p_replace_id uuid default null) returns uuid
```

- `SECURITY DEFINER`, só `service_role`.
- `PERFORM pg_advisory_xact_lock(hashtext(p_professional_id::text))` — serializa gravações do mesmo profissional.
- Confere: profissional e paciente da clínica; nenhuma consulta do profissional com status fora de (`cancelled`,`no_show`) sobrepondo `[p_start, p_end)` (excluindo `p_replace_id`); se `p_replace_id`, a consulta é do paciente, da clínica e está `scheduled`/`confirmed`.
- Erro de conflito: `RAISE EXCEPTION 'HORARIO_OCUPADO'` (P0001). Outros: `'CONSULTA_INVALIDA'`.
- Insere a nova (`status 'scheduled'`, `source 'whatsapp'`, `procedure = p_procedure`); se `p_replace_id`, marca a antiga `cancelled` na mesma transação. Devolve o id novo.

## Configuração e cálculo

### Normalização

- `tipos`: nome 1–60 caracteres; `duracao_min` 15–240 múltiplo de 15; `profissionais` lista de UUIDs da clínica ou `null`; máximo 20 tipos.
- `agendamento`: `antecedencia_h` 0–168; `dias_a_frente` 1–90; `intervalo_min` ∈ {15, 30, 60}.
- `working_hours`: por dia, até 2 períodos `HH:MM` com início < fim, sem sobreposição, ordenados.

### `calcularHorarios`

Entrada: profissionais elegíveis (`whatsapp_booking` + permitidos pelo tipo) com `working_hours`; consultas ativas no intervalo; horário da clínica (`agent_config.hours`, 6a); regras; duração; agora; fuso da clínica.

Para cada dia de `hoje` até `hoje + dias_a_frente`, no fuso da clínica:
1. Períodos do profissional naquele dia da semana, **recortados** pelo horário da clínica naquele dia (dia fechado na clínica = sem horários).
2. Candidatos a cada `intervalo_min` a partir do início do período, alinhados ao múltiplo do intervalo, cujo fim (`início + duração`) cabe no período.
3. Remove os que começam antes de `agora + antecedencia_h`.
4. Remove os que se sobrepõem a qualquer consulta ativa do profissional (status fora de `cancelled`/`no_show`).

Saída ordenada por início, depois pelo nome do profissional.

### Preferência e escolha das 5 ofertas

`preferencia` (vinda da IA): `{ dias_semana: number[] | null, periodo: 'manha' | 'tarde' | 'noite' | null, a_partir_de: 'YYYY-MM-DD' | null, profissional: string | null }` (manhã < 12h, tarde 12–18h, noite ≥ 18h; profissional por nome, comparação sem acento).

- Filtra pela preferência. Se sobrar nada, relaxa na ordem: período → dias da semana → a partir de (avisando na resposta "Não achei na terça de manhã; estes são os mais próximos:").
- Escolhe até 5, **variando**: no máximo 2 por dia, e com profissional pedido só ele.
- Grava em `conversations.offers` com `n` 1..5 e `expires_at = agora + 2 h`; registra a busca em `searches`.

## Ações da IA

### Esquema (estrito, todos os campos presentes)

```ts
{
  acao: 'responder' | 'guardar_nome' | 'passar_recepcao' | 'buscar_horarios' | 'marcar' | 'remarcar' | 'desmarcar',
  resposta: string,
  nome: string | null,          // guardar_nome; em marcar para contato novo: nome completo
  motivo: string | null,        // passar_recepcao
  tipo: string | null,          // buscar_horarios: nome do tipo, igual a um da lista
  preferencia: { dias_semana: number[] | null, periodo: 'manha'|'tarde'|'noite'|null, a_partir_de: string | null, profissional: string | null } | null,
  opcao: number | null,         // marcar / remarcar: 1..5
  consulta: string | null,      // remarcar / desmarcar: 'C1'..'C3'
}
```

### Execução (servidor)

- **buscar_horarios**: tipo inexistente/inativo → `passar_recepcao` "Tipo de consulta fora da lista"; 3 buscas em 24 h → `passar_recepcao` "Muitas buscas de horário"; nenhum profissional elegível ou nenhum horário → `passar_recepcao` "Sem horário disponível"; senão envia `resposta` da IA (introdução curta) + lista montada pelo app:
  `1) ter 11/11 às 8h30 com Dr. Carlos` … + `Qual prefere? Responda com o número.` Se `consulta` vier junto (remarcação), guarda `booking_draft.replace_appointment_id`.
- **marcar**: oferta `opcao` existente e não vencida, senão responde "Esses horários expiraram. Vou buscar de novo." e executa nova busca com o mesmo tipo. Paciente: se a conversa não tem `patient_id`, exige `nome` com pelo menos 2 palavras (senão pede o nome completo, sem gravar) e cria a ficha `{ clinic_id, name, phone, whatsapp, source: 'whatsapp' }`, ligando a conversa. Limite: 2 consultas futuras com `source = 'whatsapp'` → `passar_recepcao` "Limite de consultas pelo WhatsApp". Chama `book_whatsapp_appointment`; `HORARIO_OCUPADO` → "Esse horário acabou de ser ocupado." + nova busca. Sucesso → confirmação montada pelo app: `Pronto! {tipo} marcada para {dia da semana}, {dd/mm}, às {HHhMM} com {profissional}. {endereço da clínica, se houver}` e limpa `offers`/`booking_draft`.
- **remarcar**: `consulta` C# entre as próximas do paciente (`scheduled`/`confirmed`) e fora da antecedência mínima, senão `passar_recepcao` "Remarcação em cima da hora". Sem `opcao` → guarda `booking_draft.replace_appointment_id` e faz `buscar_horarios` (tipo = procedimento da consulta se estiver na lista, senão o primeiro tipo ativo). Com `opcao` → como `marcar`, com `p_replace_id`. Confirmação: `Pronto! Sua consulta foi remarcada para …`.
- **desmarcar**: `consulta` C# válida e fora da antecedência mínima, senão `passar_recepcao`. Atualiza `status = 'cancelled'` (filtrando clínica, paciente e status ativo). Confirmação: `Consulta de {dd/mm} às {HHhMM} desmarcada. Se quiser marcar outra data, é só pedir.`
- Toda ação de agenda bem-sucedida grava a mensagem do agente com `appointment_id` preenchido (para o rótulo na caixa de conversas).

### Contexto enviado (acréscimos ao da 6a)

```
Tipos de consulta que você pode marcar: Avaliação (30 min); Retorno (30 min)   | nenhum (não marque; passe para a recepção)
Próximas consultas do paciente: C1 = ter 11/11 10:00 Avaliação com Dra. Patrícia; C2 = ...
Opções oferecidas (válidas até 16:40): 1) ter 11/11 08:30 Dr. Carlos; 2) ...   | nenhuma
Antecedência mínima para marcar, remarcar ou desmarcar: 24 h
```

Prompt (acréscimos): só marcar tipos da lista; nunca escrever datas/horas de opções novas (o app lista); para marcar usar `opcao` de uma lista vigente; contato novo precisa de nome completo antes de `marcar`; agendar para outra pessoa → `passar_recepcao`; dúvidas sobre procedimento antes de marcar continuam com as regras da 6a.

### Validação da saída

`opcao` fora de 1..5 → trata como `responder`; `consulta` fora de C1..C3 → `responder` pedindo qual consulta; `tipo` vazio em `buscar_horarios` → `responder` perguntando o tipo; `preferencia.dias_semana` só 0–6; `a_partir_de` só data válida no futuro.

## Telas

- **Configurações → Agente do WhatsApp**: seções "Tipos de consulta pelo WhatsApp" (tabela nome, duração 15–240 de 15 em 15, profissionais Todos/seleção, ativo; adicionar/excluir; máximo 20) e "Regras de agendamento" (antecedência 0–168 h, dias à frente 1–90, intervalo 15/30/60). Aviso quando nenhum profissional tem "Atende pelo WhatsApp": "Nenhum profissional aceita agendamento pelo WhatsApp. Configure em Profissionais." (link). O bloco "Testar" mostra também as ofertas que seriam geradas (sem gravar).
- **Configurações → Profissionais**: por profissional, "Atende pelo WhatsApp" e horário de trabalho Seg→Dom com até 2 períodos, "Não atende" e "Copiar segunda para os dias úteis".
- **Agenda**: ícone do WhatsApp nas consultas com `source = 'whatsapp'`; no detalhe, "Marcada pelo WhatsApp".
- **Ficha do paciente**: etiqueta "Cadastrado pelo WhatsApp — complete CPF e dados no atendimento" enquanto `source = 'whatsapp'` e CPF vazio.
- **Mensagens → Conversas**: mensagens do agente com `appointment_id` mostram rótulo "Consulta marcada/remarcada/desmarcada" que abre a agenda na data.

## Rotas

- `GET/PUT /api/agente/config`: inclui `tipos` e `agendamento` (validação acima) e `profissionaisWhatsApp` (quantos atendem).
- `PUT /api/profissionais/[id]/agenda` (novo): `{ whatsapp_booking, working_hours }` validados; filtra por clínica.
- `POST /api/agente/testar`: inclui `ofertas` quando a ação simulada for `buscar_horarios` (sem gravar nada).

## Erros

- Qualquer erro em ação de agenda: nada é gravado pela metade (RPC transacional), nada de erro técnico ao paciente; conversa fica `unread` (como a 6a).
- `HORARIO_OCUPADO`: nova busca automática, uma vez; se falhar de novo → `passar_recepcao` "Sem horário disponível".

## LGPD e segurança

- À OpenAI vão também nomes dos tipos, horários oferecidos e as próximas consultas (data, hora, tipo, primeiro nome do profissional) — já previstas na 6a. Nome completo do contato novo fica só no banco.
- Gravação e cancelamento sempre filtrados por clínica e paciente da conversa; a IA nunca fornece ids, só números de opção e apelidos C#.

## Testes

Automáticos:
- `horarios`: dois períodos, recorte pelo horário da clínica, dia fechado, antecedência, intervalo e alinhamento, duração que não cabe no fim, sobreposição com consulta, `cancelled`/`no_show` não ocupam, fuso `America/Sao_Paulo` na virada do dia.
- `preferencia`: dias, período, a partir de, profissional sem acento, relaxamento em ordem, máximo 2 por dia.
- `ofertas`/textos: lista e confirmações exatas; apelidos C#; validade 2 h.
- `executar`: cada ação e cada desvio para a recepção; contato novo sem nome completo não grava; criação de ficha; limite de 2; `HORARIO_OCUPADO` → nova busca; remarcar só cancela a antiga via RPC.
- `esquema`: validação da saída nova.
- Config: validação de tipos, regras e `working_hours`.

Manuais: configurar profissionais e tipos; marcar avaliação; remarcar; desmarcar; tipo fora da lista; dentro de 24 h; contato novo marcando; dois celulares no mesmo horário; agenda e ficha com os indicadores.

## Fora do escopo (6b)

Feriados e bloqueios dedicados; lista de espera; sinal/pagamento antecipado; sala/cadeira; agendar para outra pessoa; vários procedimentos numa consulta; lembrete diferente para consultas do WhatsApp.
