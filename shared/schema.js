// Modelo de datos de Lemon Talent OS (Drizzle ORM + PostgreSQL).
// Fechas como 'YYYY-MM-DD' (mode string). Listas (bitácora, minutas, tags, gastos) en jsonb.
import { pgTable, text, boolean, doublePrecision, date, jsonb, timestamp } from "drizzle-orm/pg-core";

const d = (name) => date(name, { mode: "string" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  rol: text("rol").notNull().default("recruiter"), // "socio" | "admin" | "recruiter"
  passwordHash: text("password_hash").notNull(),
  activo: boolean("activo").notNull().default(true),
  creado: timestamp("creado").defaultNow(),
});

export const busquedas = pgTable("busquedas", {
  id: text("id").primaryKey(),
  puesto: text("puesto").notNull(),
  cliente: text("cliente"),
  recruiter: text("recruiter"),
  estado: text("estado").notNull().default("Activa"), // Activa | En pausa | Cerrada | Cancelada
  prioridad: text("prioridad"),
  fechaInicio: d("fecha_inicio"),
  fechaPrimeraTerna: d("fecha_primera_terna"),
  fechaCierre: d("fecha_cierre"),
  fechaIngreso: d("fecha_ingreso"),
  finGarantia: d("fin_garantia"),
  candidatoFinal: text("candidato_final"),
  garantia: boolean("garantia").default(false),
  inicioAvance: boolean("inicio_avance").default(false),
  detalle: text("detalle"),
  proximoPaso: text("proximo_paso"),
  nota: text("nota"),
  bitacora: jsonb("bitacora").default([]), // [{fecha, texto, autor}]
  minutas: jsonb("minutas").default([]), // [{fecha, titulo, url}] links de Granola
  actualizado: d("actualizado"),
});

// Datos de dinero de cada búsqueda: separados para que las recruiters no los vean.
export const busquedasFin = pgTable("busquedas_fin", {
  id: text("id").primaryKey(), // = busquedas.id
  sueldoBrutoARS: doublePrecision("sueldo_bruto_ars"),
  sueldoUSD: doublePrecision("sueldo_usd"),
  feeMultiplo: doublePrecision("fee_multiplo"),
  feeEstimadoARS: doublePrecision("fee_estimado_ars"),
  facturadoARS: doublePrecision("facturado_ars"),
  facturadoUSD: doublePrecision("facturado_usd"),
  fechaFacturacion: d("fecha_facturacion"),
  comisionARS: doublePrecision("comision_ars"),
  comisionUSD: doublePrecision("comision_usd"),
});

export const candidatos = pgTable("candidatos", {
  id: text("id").primaryKey(),
  nombre: text("nombre").notNull(),
  linkedin: text("linkedin"),
  email: text("email"),
  telefono: text("telefono"),
  ubicacion: text("ubicacion"),
  rolActual: text("rol_actual"),
  empresaActual: text("empresa_actual"),
  area: text("area"),
  seniority: text("seniority"),
  pretension: text("pretension"),
  tags: jsonb("tags").default([]),
  notas: text("notas"),
  minutas: jsonb("minutas").default([]),
  fuente: text("fuente"),
  creado: d("creado"),
});

// Candidato x búsqueda (pipeline)
export const postulaciones = pgTable("postulaciones", {
  id: text("id").primaryKey(),
  busquedaId: text("busqueda_id").notNull(),
  candidatoId: text("candidato_id").notNull(),
  etapa: text("etapa").notNull().default("Sourcing"),
  motivo: text("motivo"),
  fecha: d("fecha"),
  notas: text("notas"),
});

export const facturas = pgTable("facturas", {
  id: text("id").primaryKey(),
  emisor: text("emisor"), // MATI | PAU | Invoice
  monto: doublePrecision("monto"),
  moneda: text("moneda").default("ARS"),
  concepto: text("concepto"),
  tipo: text("tipo"), // Inicio y avance | Cierre | 50% anticipo | Cancelación
  cliente: text("cliente"),
  recruiter: text("recruiter"),
  fechaEmision: d("fecha_emision"),
  fechaPagoEstimada: d("fecha_pago_estimada"),
  cobrada: boolean("cobrada").default(false),
  fechaCobro: d("fecha_cobro"),
  comision: doublePrecision("comision"),
  monedaComision: text("moneda_comision"),
  comisionPagada: boolean("comision_pagada").default(false),
  fechaPagoComision: d("fecha_pago_comision"),
  comentarios: text("comentarios"),
  busquedaId: text("busqueda_id"),
  historico: boolean("historico").default(false),
});

export const clientes = pgTable("clientes", {
  id: text("id").primaryKey(),
  nombre: text("nombre").notNull(),
  icp: text("icp"),
  feeAcordado: text("fee_acordado"),
  contactos: text("contactos"),
  notas: text("notas"),
  origen: text("origen"),
  minutas: jsonb("minutas").default([]),
  oportunidades: jsonb("oportunidades").default([]), // [{id, fecha, puesto, notas, estado: Abierta|Convertida|Perdida, busquedaId}]
});

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  empresa: text("empresa").notNull(),
  contacto: text("contacto"),
  cargo: text("cargo"),
  linkedin: text("linkedin"),
  canal: text("canal"),
  etapa: text("etapa").default("Nuevo"),
  fechaPrimerContacto: d("fecha_primer_contacto"),
  fechaUltimoContacto: d("fecha_ultimo_contacto"),
  proximoSeguimiento: d("proximo_seguimiento"),
  icp: text("icp"),
  notas: text("notas"),
  fee: text("fee"),
  minutas: jsonb("minutas").default([]),
  contactos: jsonb("contactos").default([]), // [{nombre, cargo, email, linkedin}]
  origen: text("origen"), // Conocido | Referido de cliente | Inbound | Evento | Prospección en frío ...
  motivoPerdida: text("motivo_perdida"),
  reactivar: d("reactivar"),
});

// Un registro por mes. historico=true: importado de la planilla Economics (ingresos fijos).
// historico=false: ingresos salen de facturas; acá solo TC y gastos cargados.
export const meses = pgTable("meses", {
  mes: text("mes").primaryKey(), // 'YYYY-MM'
  tc: doublePrecision("tc"),
  ingresosARS: doublePrecision("ingresos_ars"),
  ingresosUSD: doublePrecision("ingresos_usd"),
  gastos: jsonb("gastos").default([]), // [{concepto, moneda, monto}]
  historico: boolean("historico").default(false),
});

// equipo (recruiters, capacidad, comisión %) y objetivos
export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// Bandeja de propuestas: cambios detectados por el digest (mails, calendario, Granola, chats) que esperan aprobación
export const propuestas = pgTable("propuestas", {
  id: text("id").primaryKey(),
  ref: text("ref").unique(), // id de la fuente (mail, evento, chat) para no duplicar
  fuente: text("fuente"), // Mail | Calendario | Granola | WhatsApp | LinkedIn
  cuenta: text("cuenta"),
  fecha: text("fecha"),
  resumen: text("resumen").notNull(),
  evidencia: text("evidencia"),
  link: text("link"),
  coleccion: text("coleccion").notNull(),
  registroId: text("registro_id"),
  op: text("op").notNull(), // crear | actualizar | bitacora | minuta
  datos: jsonb("datos").default({}),
  estado: text("estado").notNull().default("Pendiente"), // Pendiente | Aprobada | Rechazada
  revisadoPor: text("revisado_por"),
  revisadoEn: text("revisado_en"),
  creado: timestamp("creado").defaultNow(),
});

// Pedidos de mejora y feedback del equipo sobre el sistema
export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  autorId: text("autor_id"),
  seccion: text("seccion"),
  tipo: text("tipo"), // Error | Mejora | Idea
  texto: text("texto").notNull(),
  prioridad: text("prioridad").default("Media"),
  estado: text("estado").default("Pendiente"), // Pendiente | En curso | Hecho | Descartado
  respuesta: text("respuesta"),
  fecha: d("fecha"),
});
