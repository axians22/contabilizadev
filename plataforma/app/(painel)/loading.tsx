// Esqueleto mostrado enquanto qualquer página carrega (o Next transmite a página assim que fica pronta).
export default function Carregando() {
  const bloco = "animate-pulse rounded-2xl border border-line bg-surface motion-reduce:animate-none";
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Carregando">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
        <div className="h-9 w-72 max-w-full animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
      </div>
      <div className={`${bloco} h-24`} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${bloco} h-28`} />
        <div className={`${bloco} h-28`} />
        <div className={`${bloco} h-28`} />
      </div>
      <div className={`${bloco} h-72`} />
    </div>
  );
}
