// Verificação do ID token do Google Identity Services no servidor (google-auth-library). A assinatura, o emissor
// e a validade são conferidos pela biblioteca; o `audience` = GOOGLE_CLIENT_ID impede reaproveitar um token
// emitido para outro aplicativo. Nos testes, entra um verificador falso (nunca se chama o Google).
import { OAuth2Client } from "google-auth-library";

export type PerfilGoogle = {
  sub: string | undefined;
  email: string | undefined;
  emailVerificado: boolean | undefined;
  nome: string | undefined;
  foto: string | undefined;
};

export type VerificadorGoogle = (idToken: string) => Promise<PerfilGoogle>;

type ClienteGoogle = Pick<OAuth2Client, "verifyIdToken">;

export function criarVerificadorGoogle(clientId: string, cliente: ClienteGoogle = new OAuth2Client(clientId)): VerificadorGoogle {
  return async (idToken) => {
    const ticket = await cliente.verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    return { sub: p?.sub, email: p?.email, emailVerificado: p?.email_verified, nome: p?.name, foto: p?.picture };
  };
}
