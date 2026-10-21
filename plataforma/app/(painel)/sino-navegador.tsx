"use client";

import { useEffect, useState } from "react";
import { avisoDoCertificadoGuardado, juntarAvisos, type AvisoDoSino } from "@/lib/avisos/central";
import { cofreDoNavegador } from "@/lib/assinador/cofre";
import { SinoVisual } from "./sino-visual";

// O aviso do certificado guardado neste navegador para a empresa ativa (só o navegador sabe se há um; o servidor nunca vê
// a chave). Sem certificado guardado, cofre inacessível ou sem empresa ativa, nada.
export function useAvisoDoCertificado(cnpj: string | null): AvisoDoSino[] {
  const [avisos, setAvisos] = useState<AvisoDoSino[]>([]);
  useEffect(() => {
    if (!cnpj) return;
    let vivo = true;
    cofreDoNavegador()
      .pegar(cnpj)
      .then((registro) => vivo && setAvisos(avisoDoCertificadoGuardado(registro, cnpj, new Date())))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [cnpj]);
  return avisos;
}

// O sino com os avisos do servidor e o do certificado guardado neste navegador, juntos e sem repetir (o certificado do
// termo de autorização que vence já é avisado pela autorização).
export function SinoNoNavegador({ avisos, cnpj }: { avisos: AvisoDoSino[]; cnpj: string | null }) {
  const doCertificado = useAvisoDoCertificado(cnpj);
  return <SinoVisual avisos={doCertificado.length ? juntarAvisos(avisos, doCertificado) : avisos} />;
}
