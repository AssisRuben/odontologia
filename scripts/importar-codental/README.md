# Importação do backup do Codental: roteiro do operador

Ferramenta local em Node. Lê as planilhas do backup, gera um relatório agregado e, só quando pedido, grava no banco e envia os arquivos de pacientes.

Sem `--gravar`, nada é gravado e nenhuma conexão é aberta.

> **Dados de saúde são sensíveis.** Nunca coloque backup, planilhas, saídas ou segredos dentro do repositório, em chat, em ticket ou em pasta sincronizada.

## 1. Sequência obrigatória

Não pule etapas. Cada uma depende da anterior.

1. **SQL:** aplicar `supabase/2026-11-22-importacao-codental.sql` no ambiente alvo.
2. **Simulação:** rodar sobre o backup e revisar o relatório (seção 6).
3. **Ensaio descartável:** gravar dados anonimizados em banco e Storage descartáveis (seção 4).
4. **Homologação:** com dados anonimizados e **sem arquivos reais** (seção 5).
5. **Critérios de aceite:** conferir todos na homologação (seção 8) e remover os dados de teste (seção 9).
6. **Supabase Pro** ativo em produção.
7. **Backup do banco de produção** validado, com restauração testada.
8. **Export final** do Codental, depois que a clínica parar de usá-lo.
9. **Simulação** sobre o export final, revisada e comparada com a anterior.
10. **Gravação** em produção, com autorização explícita.
11. **Arquivos** em produção, em execução separada.

## 2. Variáveis de ambiente

Defina-as só na sessão do terminal e apague-as ao terminar. Não as coloque em arquivo versionado nem na linha de comando.

| Variável | Quando | O que é |
| --- | --- | --- |
| `IMPORT_DATABASE_URL` | `--gravar` | Conexão Postgres. Aceita apenas o parâmetro `sslmode`, com valor `require`, `verify-ca` ou `verify-full`. |
| `IMPORT_SUPABASE_URL` | `--gravar --arquivos` | Só a origem `https://` do projeto, sem caminho. |
| `IMPORT_SUPABASE_SERVICE_ROLE_KEY` | `--gravar --arquivos` | Chave de serviço do projeto. É segredo: dá acesso total ao Storage. |
| `NODE_EXTRA_CA_CERTS` | Se o TLS falhar | Caminho do certificado da CA do Supabase, baixado do painel do projeto. |

- **O papel do banco precisa ignorar RLS** (dono das tabelas ou com `BYPASSRLS`). A tabela `import_links` não tem policies, então um papel comum não consegue lê-la nem gravá-la.
- **TLS é sempre verificado.** Se a conexão falhar por certificado, use `NODE_EXTRA_CA_CERTS` com a CA do Supabase. **Nunca** desative a verificação: não use `NODE_TLS_REJECT_UNAUTHORIZED=0` nem `sslmode=no-verify`.
- Confira duas vezes para qual ambiente as variáveis apontam antes de cada `--gravar`.

Exemplo em PowerShell:

```powershell
$env:IMPORT_DATABASE_URL = Read-Host "URL do banco"
# ... execução ...
Remove-Item Env:IMPORT_DATABASE_URL
```

## 3. Comandos

`--saida` deve ficar **fora do repositório**.

```powershell
# Simulação: só relatório
npm run importar:codental -- --backup <pasta-backup> --clinica <uuid> --profissional <uuid> --saida <pasta-saida>

# Cópia anonimizada: sem rede e sem banco
npm run importar:codental -- --anonimizar --backup <pasta-backup> --saida <pasta-nova-vazia>

# Gravação do banco
npm run importar:codental -- --backup <pasta> --clinica <uuid> --profissional <uuid> --saida <pasta-saida> --gravar --confirmar-clinica <uuid>

# Simulação dos arquivos: lê o ZIP, não envia nada
npm run importar:codental -- --backup <pasta> --clinica <uuid> --profissional <uuid> --saida <pasta-saida> --arquivos <arquivo.zip>

# Envio dos arquivos: os pacientes já precisam estar gravados
npm run importar:codental -- --backup <pasta> --clinica <uuid> --profissional <uuid> --saida <pasta-saida> --gravar --confirmar-clinica <uuid> --arquivos <arquivo.zip>
```

`--profissional` é o profissional da clínica que ficará como responsável pelos registros importados.

### Anonimização

`--anonimizar` grava as planilhas em uma pasta nova. Recusa `--saida` dentro do repositório, igual a `--backup` ou dentro dele, e pasta que já tenha conteúdo. Não combina com `--gravar`, `--arquivos`, `--confirmar-clinica`, `--permitir-existentes` nem `--permitir-novos`. Ao terminar, relê a cópia e confere o relatório. Se divergir, apaga as planilhas.

- **Trocados:** nomes, CPFs (com dígito verificador propositalmente inválido), telefones (DDD 10, não atribuído), e-mails (`@example.invalid`), carteirinhas, nascimentos, sexo (sorteado entre Masculino e Feminino, vazio continua vazio), endereços, RG, profissão, contatos, responsáveis, profissionais e todo texto livre.
- **Mantidos:** IDs, `Numero`, status, datas de consultas e do financeiro, durações, valores, planos, procedimentos, preços, dentes, faces e vínculos.
- **Os ZIPs de arquivos de pacientes NÃO são anonimizados e nunca podem ser carregados na homologação.** Eles contêm radiografias, fotos e documentos reais. O anonimizador não gera nem copia arquivos.

Como os CPFs substitutos são inválidos de propósito, telas e rotinas que validam CPF (cobrança, nota fiscal, assinatura de orçamento, edição do CPF do responsável) vão recusá-los ou tratá-los como ausentes na homologação. Isso é esperado. Não troque por CPFs válidos.

A cópia anonimizada ainda mantém datas e valores reais. Trate-a como dado restrito.

## 4. Ensaio obrigatório em ambiente descartável

**O SQL de gravação e o envio ao Storage só foram exercitados com simulações (fakes) nos testes automatizados.** Antes da homologação, ensaie em um projeto Supabase descartável, com banco e Storage próprios:

1. Aplique o schema e a migração da importação.
2. Crie uma clínica e um profissional de teste.
3. Grave a cópia anonimizada e confira as contagens.
4. Rode a gravação de novo e confirme que nada muda.
5. Para o Storage, envie um ZIP **fictício**, feito só para o ensaio, nunca o ZIP real.
6. Apague o projeto descartável.

## 5. Homologação

**Antes de gravar, confirme que as mensagens automáticas de WhatsApp estão desligadas nesse ambiente.** A homologação tem integração ativa. A importação só desliga retornos e aniversários; confirmações e lembretes continuam valendo para consultas futuras importadas.

- Use somente a pasta gerada por `--anonimizar`.
- Use uma clínica de teste dedicada.
- Não use `--arquivos` com o ZIP real.
- Confirme que nenhuma mensagem foi enfileirada depois da gravação.

## 6. Como ler o relatório

A simulação grava `relatorio-simulacao.json` e imprime um resumo, só com contagens e totais.

- **contagens:** linhas por entidade. Devem bater com o backup.
- **consultas e tratamentos:** `importadas/importados` entram como histórico; `vivas/vivos` continuam ativos no sistema (consultas futuras e tratamentos planejados).
- **historico:** quantidade e total pagos e em aberto, em centavos no JSON.
- **Em orçamento de outro paciente:** deve ser 0. Qualquer outro valor aborta a gravação.

| Aviso | Significado |
| --- | --- |
| `tratamentosSemValor` | Sem preço na tabela, ou com preços conflitantes. Entram com valor 0. |
| `consultasSemDesfecho` | Passadas e ainda agendadas ou confirmadas. Entram como canceladas, com nota. |
| `evolucoesRepetidas` | Mesmo paciente, data e texto. São mantidas. |
| `gruposNomeNascimento` | Possíveis cadastros duplicados. Na cópia anonimizada é sempre 0, porque cada paciente recebe um nome único. |
| `telefonesCompartilhados` | Números usados por mais de um paciente. O agente passa essas conversas para a recepção. |
| `pagamentoAntesDoVencimentoAno` | Pagamentos com ano anterior ao do vencimento. Revise com a clínica. |

Compare a simulação do export final com a anterior. Uma queda em qualquer contagem deve ser explicada antes de gravar.

## 7. Abortos e opções de liberação

A gravação roda em uma única transação. Salvo indicação abaixo, um aborto significa que **nada foi gravado**.

| Mensagem | O que significa | O que fazer |
| --- | --- | --- |
| `Clínica não encontrada` | UUID errado ou ambiente errado. | Confira `--clinica` e as variáveis. |
| `Profissional não pertence à clínica` | Profissional de outra clínica. | Confira `--profissional`. |
| `A clínica tem N paciente(s) fora da importação` | Já existem cadastros que a importação não criou, e pode haver duplicidade. | Investigue. Só use `--permitir-existentes` se for esperado. |
| `A clínica já foi importada e o plano traria N registro(s) novo(s) sem id estável` | Consultas e histórico não têm ID na planilha. Export diferente pode gerar registros que parecem novos e duplicar dados. | Compare os exports. Só use `--permitir-novos` se os novos forem reais. |
| `orçamento de outro paciente`, `paciente diferente do já importado` | O vínculo cruzaria prontuários. | Não force. Corrija a origem. |
| `novo em orçamento já importado` | Mudaria os itens de um orçamento fechado. Não há opção que libere. | Trate manualmente com a clínica. |
| Demais `Importação recusada. ...` | Dados inconsistentes, com entidade e contagem. | Corrija a origem e simule de novo. |
| `Falha ao gravar (entidade, código, restrição)` | O banco recusou. Nada foi gravado. | Verifique se o SQL foi aplicado e o papel do banco. |
| **`Falha no COMMIT`** | **Resultado incerto.** | **Não repita.** Confira o banco primeiro. |
| `Falha na conexão com o banco` | Rede, credencial ou TLS. | Veja a seção 2. |
| `Importação incompleta: N arquivo(s) recusado(s)` | Parte dos arquivos não foi importada. Código de saída diferente de 0. | Veja `resultado-arquivos.json`. |

- **`--permitir-existentes`:** aceita gravar em clínica que já tem pacientes fora da importação. Não mescla cadastros: quem já existe e está no backup ficará duplicado.
- **`--permitir-novos`:** aceita inserir consultas e histórico sem vínculo em clínica já importada. Use só depois de confirmar que não são os mesmos registros com outra identificação.

O envio de arquivos é retomável: em caso de falha, repita o mesmo comando.

## 8. Critérios de aceite

Confira antes e depois da gravação:

- [ ] As contagens importadas batem com o relatório de origem, por entidade.
- [ ] Os totais do histórico financeiro batem com a origem.
- [ ] Livro-caixa, comissões, fluxo de caixa, A receber, indicadores e estoque ficam iguais antes e depois.
- [ ] Nenhuma mensagem foi enfileirada a partir do histórico.
- [ ] Reexecutar a importação não altera as contagens.
- [ ] Todos os pacientes aparecem na lista e na busca.

## 9. Depois dos testes

**Homologação:** remova os dados importados assim que os testes terminarem. O caminho mais simples é apagar a clínica de teste dedicada ou restaurar o ambiente a um estado anterior. Confirme que não restam pacientes nem vínculos em `import_links` dessa clínica.

**Backup e saídas locais:**

- Guarde o backup original só em disco criptografado, com acesso restrito ao operador.
- Não copie para pasta sincronizada, e-mail, chat ou repositório.
- Apague cópias anonimizadas, relatórios e resultados quando não forem mais necessários.
- Apague cópias temporárias do backup depois da virada, respeitando o prazo de guarda definido pela clínica. Em SSD, excluir não garante a remoção física; por isso o disco deve ser criptografado.
- Apague as variáveis de ambiente da sessão e revogue ou troque credenciais criadas só para a importação.

## 10. Pré-requisitos de produção

Só grave em produção com **todos** confirmados:

- [ ] SQL aplicado em produção.
- [ ] Supabase Pro ativo.
- [ ] Backup do banco validado.
- [ ] Autorização explícita do responsável.
- [ ] Export final feito depois que a clínica parou de usar o Codental.
- [ ] Simulação do export final revisada.
- [ ] Critérios de aceite aprovados na homologação.
