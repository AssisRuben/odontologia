# Importação do Codental — decisões tomadas na implementação

Complementa a especificação. Cada item traz a decisão e o custo se ela estiver errada.

## Decidido pelo responsável

- **Comissões.** A clínica desta importação não paga comissão, então nenhuma regra de alocação é necessária agora. O histórico antigo continua fora de `payments`, e o importador continua recusando clínica com comissão configurada. Se a clínica passar a pagar comissão depois da importação, a regra precisa ser definida antes de configurar as taxas: só o README alerta sobre isso.

## Leitura e mapeamento

1. A simulação no backup real é feita só pelo operador, com saída agregada. Subagentes não acessam o backup. Custo: nenhum.
2. Os itens do orçamento vêm dos tratamentos ligados a ele, e o total é sempre o original. Custo: a soma dos itens pode diferir do total.
3. Aprovado=Sim vira `approved`, e Aprovado=Não vira `draft`, sem datas de envio ou decisão. Custo: orçamentos recusados aparecem como rascunho.
4. A data do tratamento é a data de criação no Codental. Custo: a data pode ser aproximada.
5. Tratamento histórico não gera pendência de "operadora sem fechamento". Custo: a operadora só pede o dia de fechamento quando houver tratamento novo.
6. As telas não foram abertas no navegador durante a implementação, porque o ambiente local usa o banco de homologação. Custo: a conferência visual fica para a homologação.
7. Só valores pagos do histórico somam em "cobrado". Valores em aberto aparecem à parte e não bloqueiam "Gerar cobrança". Custo: a recepção pode cobrar um saldo antigo já quitado fora do sistema, por ação manual.
8. O contrato de colunas foi escrito a partir dos cabeçalhos, sem expor valores. Custo: uma divergência aparece na simulação.
9. Duração em minutos, valor do histórico = `Valor total`, sexo M/F/O, `Particular` só como tabela de preço, código do procedimento = ID de origem, preço ativo primeiro, e preço conflitante vira 0 com aviso. Custo: valores a revisar no relatório.
10. O lockfile foi refeito com npm 11.19 para preservar o build Linux. Custo se ignorado: deploy quebrado.
11. Sem ajuste de horário de verão (dados a partir de 2023). Tratamento sem face vale para o dente inteiro. O/I vira O, e L/P vira L. Custo: exibição aproximada de faces.
15. Convênio vazio em tratamento fica com valor 0 e aviso. Custo: nenhum neste backup.

## Gravação e reimportação

12. Consultas e histórico não têm ID estável. Com vínculos já existentes, linhas novas abortam a gravação, salvo `--permitir-novos`. Custo: um passo consciente a mais.
13. Campos fora dos limites do banco abortam antes de gravar. Custo: a importação para até o dado ser corrigido.
14. O relatório conta tratamentos e pagamentos ligados a orçamento de outro paciente. Custo: nenhum.
16. Clínica com pacientes fora da importação aborta, salvo `--permitir-existentes`. Custo: um passo consciente a mais.
17. Retornos e aniversários só são desligados na primeira importação. Custo: nenhum.
18. Item novo em orçamento já importado sempre aborta. Custo: exige revisão manual.
19. Tratamento ou histórico em orçamento de outro paciente sempre aborta. Custo: exige revisão manual.
20. Registro importado e apagado pela clínica não é recriado. Custo: reinserção manual, se a exclusão foi engano.

## Arquivos e anonimização

21. O caminho no Storage não usa o nome original, que fica só em `documents.name`. Custo: nenhum.
22. Arquivo recusado torna a execução incompleta. Custo: nenhum.
23. Limite de 50 MiB por arquivo, https obrigatório, documento apagado não é restaurado, e cópias mantêm a primeira categoria e nome. Custo: revisão manual de casos raros.
24. A anonimização usa substitutos aleatórios, DDD 10, `@example.invalid` e CPF com dígito inválido. Custo: cobrança e nota não funcionam na cópia.
25. O sexo também é substituído. Custo: nenhum.
26. CPF inválido na homologação é aceito, e desligar o WhatsApp lá é um passo manual. Custo: envios falhos se o passo for esquecido.
27. Datas e categorias são preservadas na cópia anonimizada. Custo: risco residual de reidentificação, então a cópia segue como dado restrito e deve ser removida após o teste.

## Revisão final

28. O importador aborta se a clínica tiver comissão configurada. Custo: importação bloqueada até a decisão.
29. O importador recusa backup com mais de um dentista. Custo: uma clínica com vários dentistas exigirá um mapeamento novo.
30. Orçamentos importados são somente leitura, mantendo "Gerar cobrança". Custo: para reaproveitar um orçamento, é preciso criar outro.
