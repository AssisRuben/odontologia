# Importação de backup do Codental — desenho

Data: 2026-11-22. Status: aprovado pelo responsável pelo produto.

## Por quê

A primeira clínica em produção vem do Codental e precisa continuar atendendo com o histórico dos pacientes. A importação não pode gerar mensagem, cobrança, comissão ou lançamento fiscal a partir de dados antigos.

## Objetivos

- Importar pacientes, convênios, consultas, evoluções, tratamentos, orçamentos, histórico financeiro e arquivos para uma clínica existente.
- Permitir simular, conferir e repetir a importação sem duplicar registros.
- Manter a ficha do paciente completa e o funcionamento do sistema correto com alguns milhares de pacientes.

## Fora do escopo

- Tela de importação self-service. O importador é uma ferramenta operacional.
- Mesclar ou apagar duplicidades do prontuário. Duplicidades só aparecem no relatório.
- Revisar os valores em aberto. A clínica faz isso depois, a partir do histórico.

## O que não pode acontecer

- Dado real de paciente no repositório, em log versionado ou em fixture.
- Registro importado alterar livro-caixa, Carnê-Leão, comissões, fluxo de caixa, A receber, indicadores, funil ou estoque.
- Mensagem automática baseada em histórico importado.
- Agente de WhatsApp presumir o paciente quando o número pertence a mais de um cadastro.
- Gravação parcial do banco em caso de erro.

## Abordagens

1. **Tabela separada para o financeiro, com marcação de origem nos demais registros (escolhida).** Nenhuma rotina financeira enxerga o histórico, porque ele não está na tabela `payments`.
2. **Importar em `payments` com uma marca.** Descartada: mais de dez módulos leem a tabela, e um filtro esquecido alteraria valores fiscais ou comissões.
3. **Guardar tudo só como documento ou texto na ficha.** Descartada: perde agenda, odontograma, orçamentos e busca.

## Desenho

### Importador

- Script Node em `scripts/importar-codental/`, executado localmente, com caminho do backup, clínica e ambiente passados como argumentos.
- Modo padrão: simulação com relatório agregado, sem gravar.
- Gravação exige uma flag explícita. Em produção, exige também a confirmação do identificador da clínica.
- O banco é gravado em uma única transação por conexão direta ao Postgres, necessária para respeitar as travas de orçamento de forma controlada.
- Idempotência por tabela de vínculo: origem, tipo, id de origem, id de destino e clínica, com chave única. Reexecução atualiza ou ignora, nunca duplica.
- Logs e relatórios ficam fora do repositório e não exibem dados pessoais.

### Mapeamentos

- Consultas: Finalizada → `completed`; Faltou → `no_show`; canceladas → `cancelled`, preservando na observação quem cancelou; Agendada → `scheduled`; Confirmada → `confirmed`.
- Consulta passada ainda agendada ou confirmada → `cancelled`, com a observação "sem desfecho registrado no Codental", e fora dos indicadores.
- Datas do Codental são interpretadas em `America/Sao_Paulo`.
- Formas de pagamento: Crédito, Débito, Dinheiro e Pix para os valores equivalentes do sistema.
- Dentes e faces de tratamentos com vários dentes são preservados em `treatment_teeth`. O valor `---` significa ausente.
- Evoluções repetidas são importadas e listadas no relatório.

### Histórico financeiro

- Nova tabela `legacy_payments`, com RLS por clínica e somente leitura para usuários logados.
- Guarda paciente, orçamento, descrição, valor, vencimento, pagamento, forma, parcela e situação original.
- A ficha do paciente mostra um bloco "Histórico do sistema anterior". Valores em aberto aparecem como histórico, nunca em A receber.
- Na aba de orçamentos, orçamentos importados exibem o valor pago a partir desse histórico.

### Marcação de origem

- `appointments`, `treatments`, `budgets` e `patients` recebem `imported_from TEXT`.
- A marca vale só para o que já está encerrado: todos os pacientes e orçamentos, consultas anteriores ao momento da importação e tratamentos finalizados.
- Consultas futuras e tratamentos em aberto ficam sem marca, porque seguem vivos: ao serem concluídos depois da virada, contam normalmente em comissões, indicadores e estoque. O vínculo com a origem fica em `import_links`.
- Comissões, indicadores, funil, guias de convênio e rotinas de estoque ignoram registros com essa marca.
- Tratamento importado como finalizado não pode ficar com baixa de material pendente. O gatilho de estoque deve respeitar a marca.
- Retorno automático ignora consultas importadas como base de cálculo.
- O backup não traz valor por tratamento. O valor vem da tabela do convênio quando procedimento e plano coincidem exatamente. Caso contrário fica 0 e entra no relatório. O total do orçamento é sempre o original.

### Mensagens

- Confirmações e lembretes continuam valendo para consultas futuras importadas.
- Retornos e aniversários ficam desligados na clínica ao final da importação, até a clínica ativá-los.
- Cobranças não têm origem no histórico, porque ele não está em `payments`.

### Telefone compartilhado

- Quando o número pertence a mais de um paciente, o agente não escolhe um cadastro nem revela dados de consulta e passa a conversa para a recepção.

### Telas

- Lista de pacientes, agenda e demais leituras de `patients` sem paginação passam a funcionar acima de 1.000 registros, por paginação completa ou busca no servidor.

### Arquivos

- Enviados ao bucket privado existente e registrados em `documents`, ligados pelo número do paciente no Codental.
- Arquivos sem extensão recebem o tipo real pelo conteúdo. Cópias idênticas no mesmo paciente são reaproveitadas.
- Etapa separada do banco, retomável, executada em produção somente depois da migração para o Supabase Pro.

## Ordem de entrega

1. Migração SQL e filtros de isolamento no sistema.
2. Correções de telas e do telefone compartilhado.
3. Importador em simulação.
4. Gravação do banco e dos arquivos.
5. Teste na homologação com dados anonimizados.
6. Produção, somente com autorização, Supabase Pro ativo, backup validado e export final da virada.

## Critérios de aceite

- Contagens importadas batem com o relatório de origem por entidade.
- Totais do histórico financeiro batem com a origem.
- Livro-caixa, comissões, fluxo de caixa, A receber, indicadores e estoque ficam iguais antes e depois da importação.
- Nenhuma mensagem é enfileirada a partir do histórico.
- Reexecutar a importação não altera as contagens.
- Todos os pacientes aparecem na lista e na busca.

## Decisões do construtor

- Nomes de arquivos, estrutura interna do script e biblioteca de leitura de planilhas.
- Forma de paginação das telas, desde que atenda aos critérios de aceite.
