# Painel de indicadores — design

Item 9 do roteiro (último). Data: 2026-11-08. Branch: `feat/indicadores`. Usa o que já está na `main`: agenda (`appointments.status`, incl. `no_show`), recebimentos (`payments`), tratamentos (`completed_at`, "Executado em"), funil de orçamentos do item 4 (`buildFunnel`, `loadFunnelSources`), pacientes (`created_at`, `source`).

## Objetivo

Trocar os números fictícios de **Relatórios → Visão geral** por indicadores reais, para o dono da clínica ver em segundos como está o mês e como vem evoluindo.

Sucesso: em 11/2026 com o filtro "Todos", o painel mostra comparecimento 90% (▲ 5 p.p. vs. outubro), 2 faltas, R$ 12.400 recebidos, ticket médio R$ 310, aprovação de orçamentos 60% em valor e 8 pacientes novos (3 pelo WhatsApp); a lista de "pacientes que mais faltam" traz quem faltou 2+ vezes em 6 meses; trocando para "Dr. Carlos", agenda, produção e orçamentos passam a ser só dele e recebido/ticket/novos mostram o aviso "geral da clínica".

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Indicadores | Agenda (faltas, cancelamentos, comparecimento), faturamento + ticket médio, aprovação de orçamentos, pacientes novos e produção |
| Período | **Mês**, com variação contra o mês anterior e tendência dos **últimos 6 meses**; filtro opcional por dentista |
| Local | **Relatórios → Visão geral**; sai o conteúdo fictício e as 6 seções "Em desenvolvimento" do menu |

## Fora do escopo

Metas configuráveis, exportar PDF/Excel, intervalo livre de datas, estoque e prótese, filtro por convênio, mudança no banco.

## Definições (`src/lib/indicadores/`)

Datas em `America/Sao_Paulo`; mês `YYYY-MM`; dinheiro em centavos inteiros; "hoje" = `todayYmd(new Date(), 'America/Sao_Paulo')`.

### Agenda (por `start_time` no mês; só consultas com `start_time` < agora)

- **Atendidas** = status `completed` ou `in_progress`; **faltas** = `no_show`; **canceladas** = `cancelled`; **sem desfecho** = `scheduled`, `confirmed` ou `waiting` já passadas.
- **Comparecimento** = atendidas ÷ (atendidas + faltas); **taxa de faltas** = faltas ÷ (atendidas + faltas); **cancelamentos %** = canceladas ÷ total de consultas passadas do mês.
- **Por dentista:** as mesmas contagens e taxas por `professional_id`.
- **Pacientes que mais faltam:** 2+ faltas nos 6 meses da janela (terminando no mês escolhido), ordem decrescente de faltas, depois nome; até 10, com nome, faltas e última falta.

### Faturamento (recebimentos `status = 'paid'`, por `fromDbPaidAt(paid_at)` no mês)

- **Recebido** = soma de `amount` (bruto); **convênio** = `payment_method = 'convenio'`; **particular** = o resto.
- **Ticket médio** = recebido ÷ pacientes distintos (`patient_id`) com recebimento no mês; também separado em particular e convênio (cada um sobre seus pacientes).
- **Produção** = soma de `value` dos tratamentos `completed` com `completed_at` no mês; total e por dentista.

### Orçamentos

- `buildFunnel(rows, { from: primeiro dia, to: último dia, professionalId })` do item 4 sobre `loadFunnelSources` — sem regra nova. Mostra apresentados, aprovados, taxa em valor e em quantidade, tempo médio até aprovar, por dentista.

### Pacientes novos

- `patients.created_at` (São Paulo) no mês; **via WhatsApp** = `source = 'whatsapp'`.

### Comparação e tendência

- **Variação** de cada cartão contra o mês anterior: taxas em pontos percentuais (`▲ 5 p.p.`), valores e contagens em % (`▲ 12%`); mês anterior com valor 0 ou sem dado → `novo` (ou `—` se ambos vazios).
- **Tendência:** série dos 6 meses terminando no mês escolhido para comparecimento, recebido, ticket médio, aprovação (valor) e pacientes novos.
- Taxa sem base (divisão por zero) = `null`, exibida como `—`.

### Filtro por dentista

Aplica-se a agenda, produção e orçamentos. Recebido, ticket e pacientes novos são sempre da clínica (recebimento não tem dentista), com o aviso "geral da clínica" quando o filtro está ativo.

| Arquivo | Responsabilidade |
|---|---|
| `periodo.ts` | Janela de 6 meses (`mesesJanela(mes)`), mês anterior, limites do mês |
| `agenda.ts` | Contagens, taxas, por dentista, pacientes que mais faltam |
| `financeiro.ts` | Recebido, ticket médio, produção |
| `variacao.ts` | Variação (p.p./%/novo) e séries de tendência |
| `painel.ts` | Monta a resposta completa a partir das linhas lidas |
| `repo.ts` | Leitura da janela de 6 meses (paginada com `lerTudo`, sempre por `clinic_id`) |

## Rota

`GET /api/indicadores?mes=YYYY-MM&dentista=<uuid opcional>` (`withClinic`) → `{ mes, hoje, parcial, dentista, cartoes, agenda, financeiro, orcamentos, novos, tendencia }`. Erros: mês inválido → 422 `'Mês inválido'`; dentista não UUID → 422 `'Identificador inválido'`; dentista de outra clínica → 404 `'Profissional não encontrado'`.

## Tela (`src/app/(dashboard)/relatorios/page.tsx`)

- Topo: seletor de mês (← →, padrão mês atual, aviso "Mês em andamento: valores parciais") e filtro de dentista.
- Cartões: Comparecimento, Faltas, Recebido, Ticket médio, Aprovação de orçamentos, Pacientes novos — número + variação.
- Blocos: **Agenda** (contagens, alerta "N consultas sem desfecho" com link para a Agenda, tabela por dentista, pacientes que mais faltam com link para a ficha); **Financeiro** (particular × convênio, ticket, produção por dentista); **Orçamentos** (funil por dentista, link para `/orcamentos`); **Tendência** (5 mini-gráficos de barras de 6 meses, sem biblioteca nova).
- Menu lateral de Relatórios com só "Visão geral"; o conteúdo fictício sai.

## Erros e bordas

Mês sem dados → tudo zero/`—`, sem erro; mês corrente parcial; consulta cancelada não entra em comparecimento; paciente com dois recebimentos no mês conta uma vez no ticket; recebimento estornado/cancelado não entra; tratamento sem dentista entra na produção total como "Sem dentista".

## Testes

Unitários para cada definição (taxas, sem desfecho, futuras excluídas, top faltosos com empate, ticket com paciente repetido, particular × convênio, produção por dentista, variação p.p./%/novo/—, janela de 6 meses atravessando o ano, filtro por dentista não afetando recebido); rota com `fakeSupabase` (422/404, filtro por clínica, paginação). Teste manual do usuário no fim.

## Documentação

README, seção nova "Indicadores": o que cada número significa e de onde vem.
