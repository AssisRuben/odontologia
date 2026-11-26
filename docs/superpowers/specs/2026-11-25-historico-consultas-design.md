# Aba "Consultas" no prontuário — design curto

## Para quê
O dentista abre o prontuário e quer, numa olhada, a visão geral das idas do paciente à clínica: quantas foram,
desde quando, com quem, o que foi feito e se ele costuma faltar. Hoje as consultas do paciente só aparecem na
agenda, dia a dia.

## Abordagens consideradas
- **A. Lista simples** (data, hora, dentista, procedimento, situação). Rápida, mas mostra quando o paciente veio,
  não o que foi feito.
- **B. Linha do tempo com resumo — escolhida.** Resumo no topo, próximas consultas, histórico agrupado por ano e,
  em cada consulta, a evolução registrada, que abre ali mesmo.
- **C. Card na Visão Geral.** Descartada: o pedido é uma aba, e o histórico completo não cabe num card.

## O que aparece
```
 18 consultas realizadas · desde mar/2024 · 2 faltas · 1 cancelada · Dra. Ana, Dr. Paulo
 ── Próximas ─────────────────────────────────────────────
 02/12/2026 qua  14:00–14:30  ● Dra. Ana   Revisão          [Agendado]
 ── 2026 ─────────────────────────────────────────────────
 18/11/2026 qua  09:30–10:30  ● Dra. Ana   Restauração 16   [Concluído]  Evolução ▾
     └ texto da evolução (abre e fecha no próprio item)
 03/10/2026 sex  10:00–10:30  ● Dr. Paulo  Limpeza          [Faltou]
 ── 2025 ─────────────────────────────────────────────────
```
- **Resumo:** consultas realizadas (situação Concluído), data da primeira consulta, faltas, cancelamentos e os
  dentistas que atenderam o paciente. Itens com zero não aparecem.
- **Próximas:** consultas a partir de agora que não estão canceladas nem marcadas como falta, da mais próxima
  para a mais distante.
- **Histórico:** todas as outras, da mais recente para a mais antiga, agrupadas por ano. Cada linha traz a data
  com o dia da semana, a hora de início e fim, o dentista (bolinha na cor dele), o procedimento e a situação
  (etiqueta nas cores que a agenda já usa).
- **Evolução:** se a consulta tem evolução, aparece "Evolução"; ao clicar, o texto abre abaixo da linha.
- **Sem consultas:** "Nenhuma consulta registrada. As consultas marcadas na agenda aparecem aqui."
- **Celular:** cada consulta vira um bloco de duas linhas: data, hora e situação em cima; dentista e
  procedimento embaixo.

## Decisões minhas (para conferir)
- A aba se chama **Consultas** e fica logo depois de **Visão Geral**. Abre também por `?aba=consultas`.
- **Ligação consulta ↔ evolução:** primeiro pela consulta gravada na evolução, que é o que a agenda já faz. Se a
  consulta não tiver evolução ligada, vale a evolução do mesmo dia que não esteja ligada a outra consulta. Isso
  cobre evoluções lançadas fora da agenda e as que vierem de outro sistema.
- **Fonte de dados:** as consultas e as evoluções que o prontuário já carrega. A busca de evoluções passa a trazer
  também a consulta ligada (`appointment_id`). Não há mudança no banco.
- **Organização do código:** a regra (separar próximas e histórico, montar o resumo, agrupar por ano, ligar as
  evoluções) fica num módulo sem tela, com testes. A aba é um componente próprio em `src/components/paciente/`.

## Fora do escopo
- Filtros (por dentista, situação ou período) e busca.
- Mudar a situação ou editar a consulta pela aba: isso continua na agenda.
- Lançar evolução pela aba.

## Fica a critério de quem constrói
Espaçamentos, ícones e o texto exato dos rótulos, desde que sigam os tokens do sistema (petróleo, gengiva, tinta,
linha, porcelana) e o visual das outras abas do prontuário.
