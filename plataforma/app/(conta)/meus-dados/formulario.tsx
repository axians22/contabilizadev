"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { UFS } from "@contabilizadev/nucleo/brasilapi/cep";
import { Explicacao } from "@/app/explicacao";
import { Botao, Campo, Cartao } from "@/app/ui";
import { formatarWhatsapp, mascararCep, mascararCpf, mascararTelefone, type Campo as NomeDoCampo } from "@/lib/usuarios/validacao";
import type { EstadoDosDados, RespostaCep } from "./acoes";

type Valores = Record<NomeDoCampo, string>;

const VAZIO: Valores = { nomeCompleto: "", cpf: "", dataNascimento: "", whatsapp: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" };

const seletor =
  "h-10 max-w-full rounded-xl border border-line bg-surface px-3 text-fg transition-colors hover:border-muted focus-visible:border-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

function Erro({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <span id={id} className="text-xs font-normal text-bad">
      {texto}
    </span>
  ) : null;
}

// Formulário de "Seus dados". O servidor confere tudo de novo (lib/usuarios/validacao.ts); aqui só as máscaras e o
// preenchimento do endereço pelo CEP (que pode falhar: aí o usuário digita). O nome e o CPF ficam só para leitura depois
// que ele cadastra uma empresa.
export function FormularioDados({
  inicial,
  aceitoAntes,
  identidadeTravada,
  hoje,
  salvar,
  buscarCep,
}: {
  inicial: Valores | null;
  aceitoAntes: boolean;
  identidadeTravada: boolean;
  hoje: string;
  salvar: (anterior: EstadoDosDados, dados: FormData) => Promise<EstadoDosDados>;
  buscarCep: (cep: string) => Promise<RespostaCep>;
}) {
  const [estado, enviar, salvando] = useActionState(salvar, undefined);
  const [v, setV] = useState<Valores>(() =>
    inicial ? { ...inicial, cpf: mascararCpf(inicial.cpf), whatsapp: formatarWhatsapp(inicial.whatsapp), cep: mascararCep(inicial.cep) } : VAZIO,
  );
  const [avisoCep, setAvisoCep] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();
  const ultimoCep = useRef(inicial?.cep ?? "");
  const erros = estado?.erros ?? {};
  const mudar = (campo: NomeDoCampo, valor: string) => setV((atual) => ({ ...atual, [campo]: valor }));

  function aoDigitarCep(texto: string) {
    const cep = mascararCep(texto);
    mudar("cep", cep);
    const digitos = cep.replace(/\D/g, "");
    if (digitos.length !== 8 || digitos === ultimoCep.current) return;
    ultimoCep.current = digitos;
    setAvisoCep(null);
    iniciar(async () => {
      let r: RespostaCep;
      try {
        r = await buscarCep(digitos);
      } catch {
        r = { erro: "Não foi possível buscar o CEP agora. Preencha o endereço à mão." };
      }
      if ("erro" in r) return setAvisoCep(r.erro);
      const e = r.endereco;
      setV((atual) => ({ ...atual, logradouro: e.logradouro ?? atual.logradouro, bairro: e.bairro ?? atual.bairro, cidade: e.cidade, uf: e.uf }));
      setAvisoCep(e.logradouro ? "Endereço preenchido pelo CEP: confira e complete o número." : "Cidade preenchida pelo CEP: complete a rua, o número e o bairro.");
    });
  }

  const campo = (nome: NomeDoCampo, rotulo: string, extra: Record<string, unknown> = {}) => (
    <div className="flex flex-col gap-1">
      <Campo
        rotulo={rotulo}
        id={nome}
        name={nome}
        value={v[nome]}
        onChange={(e) => mudar(nome, e.target.value)}
        aria-invalid={Boolean(erros[nome])}
        aria-describedby={erros[nome] ? `${nome}-erro` : undefined}
        {...extra}
      />
      <Erro id={`${nome}-erro`} texto={erros[nome]} />
    </div>
  );

  return (
    <form action={enviar} noValidate className="flex flex-col gap-5">
      <Cartao className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold">Você</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {campo("nomeCompleto", "Nome completo", {
              autoComplete: "name",
              readOnly: identidadeTravada,
              explicacao: (
                <Explicacao
                  rotulo="Qual nome devo escrever?"
                  texto={[
                    "O seu nome completo, como no CPF: é ele que conferimos no quadro de sócios da empresa (sem acento e em maiúsculas, como a Receita Federal escreve).",
                    ...(identidadeTravada ? ["Depois de cadastrar uma empresa, o nome e o CPF só mudam pelo suporte."] : []),
                  ]}
                />
              ),
            })}
          </div>
          {campo("cpf", "CPF", {
            inputMode: "numeric",
            autoComplete: "off",
            placeholder: "000.000.000-00",
            maxLength: 14,
            readOnly: identidadeTravada,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => mudar("cpf", mascararCpf(e.target.value)),
          })}
          {campo("dataNascimento", "Data de nascimento", { type: "date", max: hoje, autoComplete: "bday" })}
          {campo("whatsapp", "WhatsApp", {
            type: "tel",
            inputMode: "tel",
            autoComplete: "tel-national",
            placeholder: "(00) 00000-0000",
            maxLength: 15,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => mudar("whatsapp", mascararTelefone(e.target.value)),
            explicacao: <Explicacao rotulo="Para que serve o WhatsApp?" texto="Para falarmos com você sobre a sua conta e as obrigações da empresa. Não mandamos propaganda." />,
          })}
        </div>
      </Cartao>

      <Cartao className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold">Endereço</h2>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Campo
              rotulo="CEP"
              id="cep"
              name="cep"
              value={v.cep}
              onChange={(e) => aoDigitarCep(e.target.value)}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              maxLength={9}
              aria-invalid={Boolean(erros.cep)}
              aria-describedby="cep-ajuda"
            />
            <span id="cep-ajuda" className={`text-xs ${erros.cep ? "text-bad" : "text-muted"}`} aria-live="polite">
              {erros.cep ?? (buscando ? "Buscando o endereço…" : (avisoCep ?? "Preenchemos o endereço pelo CEP."))}
            </span>
          </div>
          <div className="sm:col-span-4">{campo("logradouro", "Rua (logradouro)", { autoComplete: "address-line1" })}</div>
          <div className="sm:col-span-2">{campo("numero", "Número", { autoComplete: "address-line2", placeholder: "S/N se não tiver" })}</div>
          <div className="sm:col-span-4">{campo("complemento", "Complemento (opcional)", { placeholder: "Apto, sala, bloco" })}</div>
          <div className="sm:col-span-3">{campo("bairro", "Bairro", { autoComplete: "address-level3" })}</div>
          <div className="sm:col-span-2">{campo("cidade", "Cidade", { autoComplete: "address-level2" })}</div>
          <div className="flex flex-col gap-1 sm:col-span-1">
            <label htmlFor="uf" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
              UF
              <select id="uf" name="uf" value={v.uf} onChange={(e) => mudar("uf", e.target.value)} className={seletor} aria-invalid={Boolean(erros.uf)} autoComplete="address-level1">
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
            <Erro id="uf-erro" texto={erros.uf} />
          </div>
        </div>
      </Cartao>

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="aceite" defaultChecked={aceitoAntes} className="mt-0.5 size-4 accent-current" aria-invalid={Boolean(erros.aceite)} />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" target="_blank" className="font-medium underline underline-offset-2">
              termos de uso e a política de privacidade
            </Link>
            .
          </span>
        </label>
        <Erro id="aceite-erro" texto={erros.aceite} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={salvando}>{salvando ? "Salvando…" : aceitoAntes ? "Salvar" : "Salvar e continuar"}</Botao>
        {estado?.mensagem && (
          <p role={estado.salvo ? "status" : "alert"} className={`text-sm ${estado.salvo ? "text-accent-ink" : "text-bad"}`}>
            {estado.mensagem}
          </p>
        )}
      </div>
    </form>
  );
}
