# Cancelado pelo paciente ou pelo dentista — design curto

## Para quê
Hoje a consulta só fica "Cancelado". A clínica quer saber quem desmarcou, para ver nos indicadores quem mais
desmarca (pacientes ou dentistas, e qual dentista) e para ter esse registro de forma confiável em cada consulta.

## Abordagens consideradas
- **A. Duas situações novas no lugar de "Cancelado".** Etiqueta e cor próprias, mas obriga a trocar cerca de 15
  lugares que tratam "cancelado" como horário livre (conferência de horário ocupado no banco, agente de IA,
  lembretes, indicadores). Esquecer um deles ocupa horário cancelado ou manda lembrete de consulta desmarcada.
- **B. Manter "Cancelado" e anotar quem cancelou — escolhida.** A situação continua `cancelled`; a consulta ganha
  o campo "quem cancelou". Quem usa vê as duas opções do mesmo jeito, e o que trata cancelado como livre não muda.

## Como funciona
- **Banco:** coluna nova em `appointments`, `cancelled_by`, com `'patient'`, `'professional'` ou vazia. SQL à parte
  em `supabase/`, rodado à mão na homologação e na produção antes de cada merge; `schema.sql` atualizado.
- **Agenda (popup e janela "Editar consulta"):** a lista de situação troca "Cancelado" por
  "Cancelado pelo paciente" e "Cancelado pelo dentista". Uma escolha só, sem pergunta extra; no popup grava na hora,
  como as outras situações. Sair de cancelado apaga "quem cancelou".
- **WhatsApp:** resposta "cancelar" ao lembrete e desmarcação/remarcação feita pelo agente de IA gravam
  `'patient'` sozinhas.
- **Cancelamentos antigos** (sem "quem cancelou") aparecem como "Cancelado". Essa opção não é oferecida para casos
  novos; se a consulta aberta já está assim, a lista a mostra para não trocar a situação sem querer.
- **Etiquetas:** onde a situação aparece (agenda, popup, aba Consultas), a etiqueta diz "Cancelado pelo paciente"
  ou "Cancelado pelo dentista". Mesma cor de hoje.
- **Indicadores:** a contagem de cancelamentos separa paciente, dentista e não informado, no total do mês e por
  dentista.
- **Aba Consultas do prontuário:** o resumo separa, por exemplo "2 cancelados pelo paciente · 1 pelo dentista".

## Não muda
Consulta cancelada continua liberando o horário na agenda, para o agente de IA e para os lembretes.

## Fora do escopo
- Motivo do cancelamento (texto livre ou lista).
- Preencher "quem cancelou" nos cancelamentos antigos.

## Decisões minhas (para conferir)
- "Pelo dentista" cobre todo cancelamento do lado da clínica (por exemplo, clínica fechada). Fácil trocar por
  "pela clínica".
- Valor gravado `'professional'` (o nome usado no banco para dentista).

## Fica a critério de quem constrói
Onde exatamente a separação entra no painel de indicadores e o texto exato do resumo, seguindo o visual atual.
