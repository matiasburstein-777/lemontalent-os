// Modelo comercial: leads por empresa (con varios contactos), origen/canal separados, motivo de pérdida,
// y oportunidades dentro de cada cliente. Incluye la migración única de los leads cargados desde la planilla.
export const COMERCIAL_SQL = `
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contactos jsonb DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origen text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_perdida text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reactivar date;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS oportunidades jsonb DEFAULT '[]'::jsonb;`;

const RANGO = { Nuevo: 0, Identificado: 0, Contactado: 1, "En conversación": 2, "Propuesta enviada": 3, Ganado: 4, Perdido: -1 };
const key = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hoy = () => { const d = new Date(Date.now() - 3 * 3600e3); return d.toISOString().slice(0, 10); };
const mas = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dias = (a, b = hoy()) => (a ? Math.round((new Date(b) - new Date(String(a).slice(0, 10))) / 864e5) : null);

function origenCanal(canal) {
  const c = key(canal);
  if (c === "linkedin") return { origen: "Prospección en frío", canal: "LinkedIn" };
  if (c === "whatsapp") return { origen: "Conocido", canal: "WhatsApp" };
  if (c === "mail") return { origen: "Prospección en frío", canal: "Mail" };
  if (c.includes("conocid")) return { origen: "Conocido", canal: "" };
  if (c.includes("referidodecliente")) return { origen: "Referido de cliente", canal: "" };
  if (c.includes("referido")) return { origen: "Referido", canal: "" };
  if (c.includes("nosescribio")) return { origen: "Inbound (nos escribió)", canal: "Mail" };
  if (c.includes("evento")) return { origen: "Evento", canal: "Evento" };
  if (c.includes("cliente")) return { origen: "Cliente anterior", canal: "" };
  return { origen: "", canal: canal || "" };
}
const contactoDe = (l) => {
  const li = String(l.linkedin || ""); const esMail = li.includes("@") && !li.includes("linkedin");
  return l.contacto || li ? { nombre: l.contacto || "", cargo: l.cargo || "", email: esMail ? li : "", linkedin: esMail ? "" : li } : null;
};

export function registerComercial(app, { pool, auth, HX }) {
  pool.query(COMERCIAL_SQL).catch((e) => console.error("No se pudieron agregar columnas comerciales:", e.message));

  // Migración: ?aplicar=1 la ejecuta; sin eso devuelve el plan (no cambia nada).
  app.post("/api/comercial/migrar", auth("admin"), async (req, res, next) => {
    const client = await pool.connect(); let suelto = false;
    try {
      const aplicar = req.query.aplicar === "1";
      const ya = (await client.query("SELECT value FROM config WHERE key='migracionLeads'")).rows[0];
      if (ya && aplicar && req.query.forzar !== "1") return res.status(400).json({ error: "La migración ya se aplicó el " + ya.value.fecha + "." });
      const leads = (await client.query("SELECT *, fecha_primer_contacto::text AS _fp, fecha_ultimo_contacto::text AS _fu, proximo_seguimiento::text AS _ps, reactivar::text AS _re FROM leads")).rows
        .map(({ _fp, _fu, _ps, _re, ...l }) => ({ ...l, fecha_primer_contacto: _fp, fecha_ultimo_contacto: _fu, proximo_seguimiento: _ps, reactivar: _re }));
      const clientes = (await client.query("SELECT * FROM clientes")).rows;
      const busq = (await client.query("SELECT cliente FROM busquedas")).rows;
      const conBusq = new Set(busq.map((b) => key(b.cliente)));
      const cliPorKey = Object.fromEntries(clientes.map((c) => [key(c.nombre), c]));
      const plan = { aClientes: [], aRevisar: [], sinRespuesta: [], identificado: 0, perdidosMotivo: {}, fusionados: [], seguimientos: 0 };
      const borrar = new Set(); const upd = {}; const cliUpd = {};

      // 1) Etapas, origen/canal, motivos y contactos
      for (const l of leads) {
        const u = { ...l };
        const oc = origenCanal(l.canal); u.origen = l.origen || oc.origen; u.canal = oc.canal;
        const c = contactoDe(l); u.contactos = Array.isArray(l.contactos) && l.contactos.length ? l.contactos : c ? [c] : [];
        const ult = l.fecha_ultimo_contacto || l.fecha_primer_contacto;
        if (l.etapa === "Nuevo") { u.etapa = "Identificado"; plan.identificado++; }
        if (l.etapa === "Ganado") {
          if (conBusq.has(key(l.empresa))) {
            plan.aClientes.push(l.empresa); borrar.add(l.id);
            const k = key(l.empresa); const cl = cliUpd[k] || cliPorKey[k];
            if (cl) {
              const linea = [c?.nombre, c?.cargo, c?.email || c?.linkedin].filter(Boolean).join(" · ");
              const prev = String(cl.contactos || "");
              if (linea && !prev.includes(c?.nombre || linea)) cliUpd[k] = { ...cl, contactos: [prev, linea].filter(Boolean).join("\n") };
            }
            continue;
          }
          u.etapa = "En conversación"; u.notas = [l.notas, "Revisar: figuraba como cliente activo en la planilla."].filter(Boolean).join(" · ");
          plan.aRevisar.push(l.empresa);
        }
        if (l.etapa === "Contactado" && (dias(ult) ?? 999) > 90) {
          u.etapa = "Perdido"; u.motivo_perdida = "Sin respuesta"; u.reactivar = mas(hoy(), 90);
          u.notas = [l.notas, "Sin respuesta en más de 90 días (migración)."].filter(Boolean).join(" · ");
          plan.sinRespuesta.push(l.empresa);
        }
        if (l.etapa === "Perdido" && !l.motivo_perdida) {
          u.motivo_perdida = /no avanz/i.test(l.notas || "") ? "Propuesta no avanzó" : "No interesado";
          plan.perdidosMotivo[u.motivo_perdida] = (plan.perdidosMotivo[u.motivo_perdida] || 0) + 1;
        }
        if (["Contactado", "En conversación", "Propuesta enviada", "Identificado"].includes(u.etapa) && !u.proximo_seguimiento && u.etapa !== "Identificado") {
          u.proximo_seguimiento = mas(hoy(), 7); plan.seguimientos++;
        }
        upd[l.id] = u;
      }
      // 2) Un lead por empresa: se queda el más avanzado y absorbe contactos, notas y fechas
      const grupos = {};
      for (const u of Object.values(upd)) (grupos[key(u.empresa)] ||= []).push(u);
      for (const g of Object.values(grupos)) {
        if (g.length < 2) continue;
        g.sort((a, b) => (RANGO[b.etapa] ?? 0) - (RANGO[a.etapa] ?? 0) || String(b.fecha_ultimo_contacto || "").localeCompare(String(a.fecha_ultimo_contacto || "")));
        const [p, ...resto] = g;
        for (const r of resto) {
          for (const c of r.contactos || []) if (!p.contactos.some((x) => key(x.nombre) === key(c.nombre))) p.contactos.push(c);
          if (r.notas && !String(p.notas || "").includes(r.notas)) p.notas = [p.notas, r.notas].filter(Boolean).join(" · ");
          const fp = [p.fecha_primer_contacto, r.fecha_primer_contacto].filter(Boolean).map(String).sort()[0]; if (fp) p.fecha_primer_contacto = fp.slice(0, 10);
          const fu = [p.fecha_ultimo_contacto, r.fecha_ultimo_contacto].filter(Boolean).map(String).sort().pop(); if (fu) p.fecha_ultimo_contacto = fu.slice(0, 10);
          borrar.add(r.id); delete upd[r.id];
        }
        plan.fusionados.push(`${p.empresa} (${g.length} → 1)`);
      }
      const resumen = {
        leadsAntes: leads.length, leadsDespues: Object.keys(upd).length,
        pasanAClientes: plan.aClientes, aRevisarEnConversacion: plan.aRevisar, perdidosSinRespuesta: plan.sinRespuesta.length,
        identificados: plan.identificado, motivosPerdidos: plan.perdidosMotivo, empresasFusionadas: plan.fusionados, seguimientosAgendados: plan.seguimientos,
        clientesConContactosNuevos: Object.keys(cliUpd).length,
      };
      if (!aplicar) return res.json({ simulacion: true, ...resumen });

      await client.query("BEGIN");
      for (const id of borrar) {
        const l = leads.find((x) => x.id === id);
        await client.query("INSERT INTO papelera (id, usuario_id, coleccion, registro_id, datos) VALUES ($1,$2,'leads',$3,$4)", ["pp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), req.user.id, id, JSON.stringify(camel(l))]);
        await client.query("DELETE FROM leads WHERE id=$1", [id]);
      }
      for (const u of Object.values(upd)) {
        await client.query(`UPDATE leads SET etapa=$2, origen=$3, canal=$4, contactos=$5, notas=$6, motivo_perdida=$7, reactivar=$8, proximo_seguimiento=$9, fecha_primer_contacto=$10, fecha_ultimo_contacto=$11 WHERE id=$1`,
          [u.id, u.etapa, u.origen || null, u.canal || null, JSON.stringify(u.contactos || []), u.notas || null, u.motivo_perdida || null, u.reactivar || null, u.proximo_seguimiento || null, u.fecha_primer_contacto || null, u.fecha_ultimo_contacto || null]);
      }
      for (const c of Object.values(cliUpd)) await client.query("UPDATE clientes SET contactos=$2 WHERE id=$1", [c.id, c.contactos]);
      await client.query("INSERT INTO config (key, value) VALUES ('migracionLeads', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ fecha: hoy(), por: req.user.id, resumen })]);
      await client.query("COMMIT");
      client.release(); suelto = true;
      await HX.registrar(req.user, "leads", "migracion", "editar", {}, { migracion: `${leads.length} → ${Object.keys(upd).length} leads` });
      res.json({ aplicado: true, ...resumen });
    } catch (e) { try { await client.query("ROLLBACK"); } catch {} next(e); } finally { if (!suelto) client.release(); }
  });
}

const camel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
