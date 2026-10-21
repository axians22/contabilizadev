"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from "react";
import { conferirArquivo, formatarTamanho, listarExtensoes, type ArquivoEscolhido } from "@/lib/arquivo";

// Campo único de envio de arquivo (hoje: o .pfx do e-CNPJ A1, na tela da plataforma e no assinador do navegador).
// Uma área grande para arrastar e soltar ou clicar, com os tipos e o tamanho aceitos à vista; depois de escolher, o nome
// e o tamanho do arquivo e "Trocar arquivo"; tipo errado vira uma mensagem simples e o arquivo não fica escolhido.
// Por baixo é um <input type="file"> de verdade, dentro do próprio <label>: o formulário (FormData ou
// elements.namedItem) recebe o arquivo como sempre, o Tab chega nele (o contorno de foco aparece na área), Enter ou
// Espaço abrem o seletor e o leitor de tela anuncia o rótulo, os tipos aceitos e o arquivo escolhido. O reset do
// formulário limpa a escolha.

const foco = "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent-ink";

type Props = {
  id: string;
  name: string;
  rotulo?: string; // o nome do campo, acima da área ("Arquivo do e-CNPJ A1")
  rotuloPor?: string; // ou o id de um texto que já dá nome ao campo (o título do passo), sem repetir acima da área
  chamada: string; // a frase da área ("Arraste o arquivo .pfx aqui ou clique para escolher")
  extensoes: readonly string[]; // [".pfx", ".p12"]
  accept: string; // o filtro do seletor do sistema
  tamanhoMaximo: number;
  required?: boolean;
  disabled?: boolean;
  explicacao?: ReactNode; // tooltip (<Explicacao>) ao lado do rótulo, fora do <label>
  aoMudar?: (arquivo: File | null) => void;
};

export function CampoArquivo({ id, name, rotulo, rotuloPor, chamada, extensoes, accept, tamanhoMaximo, required, disabled, explicacao, aoMudar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhido, setEscolhido] = useState<ArquivoEscolhido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  // O reset do formulário (depois de enviar ou assinar) limpa o arquivo do input; a vista acompanha.
  useEffect(() => {
    const form = entrada.current?.form;
    if (!form) return;
    const limpar = () => {
      setEscolhido(null);
      setErro(null);
    };
    form.addEventListener("reset", limpar);
    return () => form.removeEventListener("reset", limpar);
  }, []);

  function escolher(arquivo: File | undefined) {
    const input = entrada.current;
    if (!arquivo) {
      setEscolhido(null);
      setErro(null);
      aoMudar?.(null);
      return;
    }
    const problema = conferirArquivo({ nome: arquivo.name, tamanho: arquivo.size }, { extensoes, tamanhoMaximo });
    if (problema) {
      // O arquivo errado não fica no input: o "required" do formulário segura o envio.
      if (input) input.value = "";
      setEscolhido(null);
      setErro(problema);
      aoMudar?.(null);
      return;
    }
    setErro(null);
    setEscolhido({ nome: arquivo.name, tamanho: arquivo.size });
    aoMudar?.(arquivo);
  }

  function soltar(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastando(false);
    if (disabled) return;
    const arquivo = e.dataTransfer.files?.[0];
    const input = entrada.current;
    if (!arquivo || !input) return;
    // Só o primeiro arquivo vai para o input (o formulário lê de lá, como no clique).
    if (!conferirArquivo({ nome: arquivo.name, tamanho: arquivo.size }, { extensoes, tamanhoMaximo })) {
      try {
        const lista = new DataTransfer();
        lista.items.add(arquivo);
        input.files = lista.files;
      } catch {
        input.files = e.dataTransfer.files;
      }
    }
    escolher(arquivo);
  }

  return (
    <VistaDoCampoArquivo
      id={id}
      rotulo={rotulo}
      rotuloPor={rotuloPor}
      chamada={chamada}
      extensoes={extensoes}
      tamanhoMaximo={tamanhoMaximo}
      escolhido={escolhido}
      erro={erro}
      arrastando={arrastando}
      disabled={disabled}
      explicacao={explicacao}
      entrada={{
        ref: entrada,
        id,
        name,
        accept,
        required,
        onChange: (e) => escolher(e.currentTarget.files?.[0]),
      }}
      eventos={{
        onDragEnter: (e) => {
          e.preventDefault();
          if (!disabled) setArrastando(true);
        },
        onDragOver: (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = disabled ? "none" : "copy";
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
        },
        onDrop: soltar,
      }}
    />
  );
}

// A parte visual, sem estado (o CampoArquivo guarda o estado; os testes de tela desenham cada estado daqui).
export function VistaDoCampoArquivo({
  id,
  rotulo,
  rotuloPor,
  chamada,
  extensoes,
  tamanhoMaximo,
  escolhido,
  erro,
  arrastando = false,
  disabled = false,
  explicacao,
  eventos,
  entrada,
}: {
  id: string;
  rotulo?: string;
  rotuloPor?: string;
  chamada: string;
  extensoes: readonly string[];
  tamanhoMaximo: number;
  escolhido: ArquivoEscolhido | null;
  erro: string | null;
  arrastando?: boolean;
  disabled?: boolean;
  explicacao?: ReactNode;
  eventos?: Pick<ComponentProps<"label">, "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop">;
  entrada?: Omit<ComponentProps<"input">, "type" | "className" | "disabled">; // o <input type="file"> de verdade (name, accept, ref…)
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { rotulo: `${id}-rotulo-${base}`, aceitos: `${id}-aceitos-${base}`, escolhido: `${id}-escolhido-${base}`, erro: `${id}-erro-${base}` };
  const aceitos = `Arquivo ${listarExtensoes(extensoes)} · até ${formatarTamanho(tamanhoMaximo)}`;
  const descricao = [escolhido ? ids.escolhido : ids.aceitos, erro ? ids.erro : null].filter(Boolean).join(" ");
  const cor = erro ? "border-bad/60 bg-bad/5" : arrastando ? "border-accent-ink bg-accent/10" : escolhido ? "border-accent-ink/50 bg-surface" : "border-line bg-raised/40 hover:border-muted hover:bg-raised/70";

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
      {!rotuloPor && (
        <span className="flex items-center gap-1 font-medium text-muted">
          <span id={ids.rotulo}>{rotulo}</span>
          {explicacao}
        </span>
      )}
      <label
        data-campo-arquivo=""
        data-estado={erro ? "erro" : escolhido ? "escolhido" : "vazio"}
        className={`relative flex w-full min-w-0 items-center gap-4 rounded-2xl border-2 border-dashed px-4 py-5 transition-colors sm:px-5 ${cor} ${foco} ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
        {...eventos}
      >
        {/* O input fica dentro do label: clicar em qualquer ponto da área abre o seletor. */}
        <input {...entrada} id={id} type="file" disabled={disabled} aria-labelledby={rotuloPor ?? ids.rotulo} aria-describedby={descricao} className="sr-only" />
        <IconeDocumento escolhido={Boolean(escolhido)} />
        {escolhido ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span id={ids.escolhido} className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-fg">{escolhido.nome}</span>
              <span className="text-xs text-muted">
                <span className="sr-only">Arquivo escolhido, </span>
                {formatarTamanho(escolhido.tamanho)}
              </span>
            </span>
            <span aria-hidden="true" className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-sm font-medium text-fg">
              Trocar arquivo
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-fg">{chamada}</span>
            <span id={ids.aceitos} className="text-xs text-muted">
              {aceitos}
            </span>
          </span>
        )}
      </label>
      {erro && (
        <p id={ids.erro} role="alert" className="text-sm text-bad">
          {erro}
        </p>
      )}
    </div>
  );
}

function IconeDocumento({ escolhido }: { escolhido: boolean }) {
  return (
    <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-xl ${escolhido ? "bg-accent text-on-accent" : "bg-surface text-accent-ink"} border border-line`}>
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        {escolhido ? <path d="m9 14 2 2 4-4" /> : <path d="M12 17v-6m-2.5 2.5L12 11l2.5 2.5" />}
      </svg>
    </span>
  );
}
