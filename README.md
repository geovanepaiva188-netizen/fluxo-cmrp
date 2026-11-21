# Fluxo CMRP

App para acompanhar os pedidos de aprovação **Sandra › Adriana › UICF**, os e-mails **a responder** (Mariana, Suedy, DP, Recepção…) e as **máquinas locadas** das obras do Consórcio CMRP e da Construtora Ceará Mendes.

- **Celular e PC:** site em `https://SEU-PROJETO.web.app` e app Android (APK).
- **Robô:** a cada 10 minutos, lê **somente para leitura** as contas LocaWeb conectadas no app e atualiza tudo sozinho.
- **Sem programação no dia a dia:** usuários, obras, aprovadores, substitutos, palavras e remetentes se ajustam pelo app, em **Ajustes**.
- **Custo:** zero. Usa o plano gratuito do Firebase (Spark) e o GitHub Actions.

> A autorização oficial continua sendo o **e-mail**. O app é acompanhamento.

---

## Como funciona

```
LocaWeb (IMAP, só leitura) ──► Robô no GitHub (a cada 10 min) ──► Firebase (banco + login) ──► App (PC e Android)
```

1. Cada pessoa entra no app com **matrícula e senha**. O cadastro só vale depois que o **administrador aprova**.
2. Em **Minha conta**, a pessoa conecta o **próprio e-mail LocaWeb**. A senha é trancada no aparelho dela com a chave pública do robô. No banco, fica só a versão trancada.
3. O robô decifra a senha, lê a **Caixa de Entrada** e os **Enviados** e monta as cadeias:
   - um pedido nasce quando a conta envia um e-mail à primeira etapa (Sandra ou Matheus) com "Solicito aprovação/autorização";
   - um encaminhamento para a próxima etapa, ou "Autorizado", acende a luz verde;
   - "corrigir", "inserir no DD", "não autorizado" e palavras parecidas acendem a luz âmbar: o pedido fica **Devolvido** e você recebe um aviso;
   - uma resposta que não aprova nem devolve fica como **Conferir**;
   - um reenvio (mesmo assunto, "REV05" ou "Re:") volta o pedido para "aguardando" e mantém o histórico;
   - quando o UICF aprova, o robô gera o **PDF do comprovante** e atualiza a **máquina** (último e próximo BM).
4. E-mails dos remetentes de "A responder" ficam abertos até você responder (ou marcar "Resolvido" no app).

## Primeira instalação (uma vez só)

### 1. Firebase (console.firebase.google.com)
1. **Criar projeto** com o nome `fluxo-cmrp`, sem Google Analytics.
2. **Authentication** › Começar › **E-mail/senha** › Ativar.
3. **Firestore Database** › Criar banco › modo **produção** › local **southamerica-east1 (São Paulo)**.
4. **Configurações do projeto** › Seus apps › **Web (</>)** › registrar `Fluxo CMRP`. Copie o bloco `firebaseConfig` para `web/firebase-config.js`.
5. **Configurações do projeto** › **Contas de serviço** › **Gerar nova chave privada**. O arquivo `.json` baixado é a chave do robô. **Não envie esse arquivo para ninguém e não o coloque no repositório.**

### 2. GitHub
No repositório › **Settings** › **Secrets and variables** › **Actions**:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | o conteúdo inteiro do arquivo `.json` do passo 1.5 |
| Secret | `ROBO_SEGREDO` | uma frase longa e aleatória, que só existe aqui (ex.: 6 palavras sem relação) |
| Variable | `FIREBASE_PROJECT_ID` | o ID do projeto (ex.: `fluxo-cmrp-1a2b3`) |

### 3. Publicar e criar o administrador
1. **Actions** › **Publicar app** › *Run workflow*. Depois, o site fica em `https://FIREBASE_PROJECT_ID.web.app`.
2. **Abra o site e crie o administrador logo em seguida.** O primeiro cadastro vira administrador.
3. **Actions** › **Robô do Fluxo** › *Run workflow* (a primeira rodada cria a chave do robô e as obras iniciais).
4. No app, em **Minha conta** › **Conectar meu e-mail**. Em até 10 minutos aparecem os primeiros processos.

### 4. App Android
**Actions** › **Gerar APK** › *Run workflow*. Ao terminar, abra **Releases** no celular, baixe o `FluxoCMRP.apk` e instale.

## Dia a dia (tudo pelo app)
- **Ajustes › Usuários:** aprovar pedidos de acesso, escolher o que cada pessoa vê (próprios fluxos, obras marcadas ou tudo), esconder RH e exames, permitir ou não conectar e-mail e encerrar processos, e suspender ou remover pessoas.
- **Ajustes › Obras:** cadastrar uma obra nova e as palavras que identificam a obra no assunto do e-mail. Obras com histórico não são apagadas, só encerradas.
- **Ajustes › Fluxo de aprovação:** aprovadores e ordem, etapa inicial (Matheus), substitutos com datas e palavras de aprovação e de devolução.
- **Ajustes › A responder:** quem acompanhar e se entra tudo ou só o que parece pedido.
- **Ajustes › Robô:** situação de cada conta conectada, servidor IMAP e prazos.
- **Ajustes › Histórico de ações:** quem aprovou, mudou ou excluiu o quê.

## Segurança
- **Acesso:** ninguém lê dados sem aprovação do administrador. As regras ficam em `firestore.rules` e valem no servidor, não só na tela.
- **Senha do e-mail:** fica trancada com RSA-OAEP. A chave privada do robô fica no Firestore cifrada com `ROBO_SEGREDO`, que só existe no cofre do GitHub.
- **Leitura do e-mail:** o robô abre as pastas em modo **somente leitura** (EXAMINE): não marca como lido, não move, não apaga e não envia.
- **Repositório público:** só tem código. Os registros do robô mostram apenas contagens. O arquivo de histórico e as chaves estão no `.gitignore`.
- **Riscos:** quem controla a conta do GitHub e o projeto Firebase controla o robô. Use **verificação em duas etapas** no GitHub e no Google, e de preferência contas da empresa.

## Estrutura
```
web/            app (HTML + JS, sem build)        → Firebase Hosting
firestore.rules regras de acesso                   → Firestore
robo/           robô Python (IMAP → regras → Firestore, PDFs)
android-app/    casca Android (Capacitor) que abre o site
.github/        rotinas: robô, publicar, testes, APK, manutenção
```

## Testes
`python -m pytest robo -q` cobre cadeia completa, horários citados no encaminhamento do UICF, devolução e reenvio, revisão (REV05), aprovação direta da Sandra, resposta ambígua, "A responder", dois usuários vendo o mesmo e-mail e leitura de e-mail HTML.
