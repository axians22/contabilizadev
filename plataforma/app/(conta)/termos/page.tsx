import { Cartao, Titulo } from "@/app/ui";
import { exigirSessaoSemDados } from "@/lib/autenticacao/servidor";
import { DATA_DOS_TERMOS, POLITICA_DE_PRIVACIDADE, TERMOS_DE_USO, type SecaoDosTermos } from "@/lib/usuarios/termos";

export const metadata = { title: "Termos e privacidade · ContabilizaDev" };

function Documento({ titulo, secoes }: { titulo: string; secoes: SecaoDosTermos[] }) {
  return (
    <Cartao className="flex flex-col gap-4 px-5 py-5 sm:px-6">
      <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
      {secoes.map((s) => (
        <section key={s.titulo} className="flex flex-col gap-1.5 text-sm leading-relaxed">
          <h3 className="font-semibold">{s.titulo}</h3>
          {s.paragrafos.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      ))}
    </Cartao>
  );
}

// Os termos de uso e a política de privacidade (texto provisório até a Parte 9), abertos a partir de "Seus dados". Ficam
// fora do portão do primeiro login: é preciso ler antes de aceitar.
export default async function Termos() {
  await exigirSessaoSemDados();
  return (
    <>
      <Titulo sobre={`Versão provisória de ${DATA_DOS_TERMOS}`}>Termos de uso e privacidade</Titulo>
      <Documento titulo="Termos de uso" secoes={TERMOS_DE_USO} />
      <Documento titulo="Política de privacidade" secoes={POLITICA_DE_PRIVACIDADE} />
    </>
  );
}
