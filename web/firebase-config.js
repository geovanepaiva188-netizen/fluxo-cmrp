// Preencha com os dados do seu projeto Firebase:
// Console do Firebase › Configurações do projeto › Seus apps › App da Web › "firebaseConfig".
// (Estes dados não são segredo: a proteção é feita pelas regras de segurança do Firestore.)
export const firebaseConfig = {
  apiKey: "PREENCHER",
  authDomain: "PREENCHER.firebaseapp.com",
  projectId: "PREENCHER",
  storageBucket: "PREENCHER.appspot.com",
  messagingSenderId: "PREENCHER",
  appId: "PREENCHER"
};

// Domínio usado para transformar a matrícula em login (ex.: GEOVANE -> geovane@fluxo-cmrp.app).
export const DOMINIO_MATRICULA = "fluxo-cmrp.app";

// Só para testes locais com o emulador do Firebase.
export const USAR_EMULADOR = location.hostname === "localhost" || location.hostname === "127.0.0.1";
