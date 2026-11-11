## Para que serve

O agente é um assistente que responde os pacientes no WhatsApp: tira dúvidas com os dados da clínica, marca, remarca e desmarca consultas, e passa para a recepção o que não souber. As conversas aparecem em [Mensagens](#mensagens).

## Antes de começar

- WhatsApp conectado em [Mensagens automáticas](#config-mensagens).
- Chave da OpenAI cadastrada em [Inteligência artificial](#ia).
- Horários de cada dentista em [Profissionais](#profissionais) (opção **Atende pelo WhatsApp**).

Enquanto faltar algo, a tela mostra "Para ligar o agente, falta:" com o que precisa ser feito.

## Configurar o agente

1. Em **Configurações**, clique em **Agente do WhatsApp**.
2. Em **Horário de atendimento**, desmarque **Fechado** nos dias em que a clínica atende e informe o horário.
3. Em **Regras de agendamento**, defina:
   - **Antecedência mínima (horas)**: com quanto tempo de antecedência o agente pode marcar;
   - **Dias à frente**: até quantos dias à frente ele oferece horários;
   - **Intervalo entre horários**: **15 min**, **30 min** ou **60 min**.
4. Em **Tipos de consulta pelo WhatsApp**, cadastre o que o agente pode marcar (ex.: Limpeza, Avaliação). Ele só marca os tipos ativos da lista.
5. Em **Informações para o agente**, escreva o que ele deve saber para responder dúvidas: estacionamento, formas de pagamento, avaliação gratuita etc. Ele também usa os dados de **O agente também usa estes dados da clínica** (endereço, telefone, convênios), que vêm das outras configurações.
6. Ligue **Agente ligado** e salve.

![Configuração do agente](/ajuda/img/agente.png)

## Testar antes de ligar

No quadro de teste, escreva como se fosse um paciente (ex.: "Vocês atendem sábado?") e clique em **Testar**. A tela mostra o que o agente **Responderia**, usando as configurações já salvas. Nada é enviado ao paciente.

## Dúvidas comuns

**O WhatsApp Business manda uma saudação automática.** Desative a saudação e a mensagem de ausência no aplicativo WhatsApp Business: com o agente ligado, ele responde no lugar delas.
