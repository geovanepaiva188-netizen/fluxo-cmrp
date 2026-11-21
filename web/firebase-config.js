// Dados do projeto Firebase "Fluxo de Email" (fluxo-de-email).
// Estes dados não são segredo: a proteção é feita pelas regras de segurança do Firestore.
export const firebaseConfig = {
  apiKey: "AIzaSyCF8gcN_43Lv9Xb8MjwguH36yGBadhSpXk",
  authDomain: "fluxo-de-email.firebaseapp.com",
  projectId: "fluxo-de-email",
  storageBucket: "fluxo-de-email.firebasestorage.app",
  messagingSenderId: "307400413301",
  appId: "1:307400413301:web:b98a95492b76c56db7683c"
};

// Domínio usado para transformar a matrícula em login (ex.: GEOVANE -> geovane@fluxo-cmrp.app).
export const DOMINIO_MATRICULA = "fluxo-cmrp.app";

// Só para testes locais com o emulador do Firebase.
export const USAR_EMULADOR = location.hostname === "localhost" || location.hostname === "127.0.0.1";
