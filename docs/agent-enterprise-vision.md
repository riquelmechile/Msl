# MSL Agent Enterprise Vision

MSL is una empresa agente liderada por un CEO: una jerarquía de agentes especializados que aprenden, colaboran y proponen acciones de negocio de alta utilidad mientras el CEO humano mantiene el control de las decisiones comerciales a través de aprobaciones en Telegram.

MercadoLibre es el primer canal operativo, no el límite del producto. El objetivo del producto es construir una organización de aprendizaje consciente de costos que pueda operar Plasticov y Maustian hoy y luego expandirse a ecommerce propio, redes sociales, operaciones de proveedores, publicidad, contenido y marketplaces adicionales.

## Lo que MSL es y no es

| MSL es                                 | Significado                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Una empresa simulada                   | Los agentes actúan como departamentos, gerentes y especialistas con límites de responsabilidad claros.                  |
| Controlada por un CEO                  | El CEO humano aprueba, rechaza o redirige las decisiones de negocio; los agentes investigan de forma autónoma y barata. |
| Infraestructura de aprendizaje         | Cortex almacena memoria operativa; el feedback darwiniano refuerza patrones útiles y debilita los malos.                |
| Operaciones de IA conscientes de costo | Los especialistas con caché de DeepSeek usan prompts estables y reglas de ruteo para mantener el razonamiento barato.   |
| Infraestructura de comercio multicanal | MercadoLibre es el primer canal; la arquitectura debe crecer hacia ecommerce, redes sociales, proveedores y más.        |

| MSL no es                                | Por qué                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Un bot de sincronización de MercadoLibre | La sincronización es una operación acotada, no el producto.                        |
| Un dashboard                             | MSL propone acciones, no solo muestra datos.                                       |
| Una colección suelta de herramientas     | Los agentes colaboran con memoria compartida y evidencia entre pares.              |
| Un motor de mutación autónoma            | Cada mutación requiere aprobación explícita del CEO.                               |
| Un asistente único                       | Los especialistas tienen dominio acotado; el CEO coordina.                         |
| Una UI de selección de agentes           | El CEO habla con el CEO Agent; los workers son recursos internos de orquestación.  |
| Un dashboard de facturación              | La evidencia del ledger de costos es contexto operativo, no verdad de facturación. |

## Principio de arquitectura

MSL utiliza un **núcleo inteligente dentro de una carcasa determinista de seguridad**.

### El núcleo inteligente

El núcleo inteligente comprende objetivos abiertos, investiga, relaciona señales, formula hipótesis, solicita evidencia a otros agentes, debate alternativas, cuestiona supuestos, infiere oportunidades y riesgos, propone planes contextualizados, observa resultados y aprende de la experiencia real.

### La carcasa determinista de seguridad

La carcasa determinista protege el negocio con reglas no negociables: autenticación y autorización, alcance por `sellerId`/`accountId`, validación de esquemas, permisos, presupuestos máximos, aprobación humana, idempotencia, deduplicación, auditoría, límites legales, prevención de mutación accidental y aislamiento de secretos.

Las reglas deterministas sirven para seguridad, filtrado, validación, detección inicial, cálculos exactos, scheduling básico, recuperación de fallos y reducción de costos. Pero las decisiones de negocio ambiguas deben aprovechar el razonamiento de DeepSeek, la memoria de Cortex, la evidencia operativa y la colaboración entre agentes.

## Modelo operativo

MSL debe funcionar como una empresa real cuyos empleados son agentes de IA.

```
CEO Humano
  └─ CEO Agent
      ├─ Director Financiero y Rentabilidad
      ├─ Director de Portafolio
      ├─ Director de Inventario, Compras e Importaciones
      ├─ Director de Crecimiento Social
      └─ Director de Expansión
           ├─ Agente de Resultados Económicos
           ├─ Agente de Lanzamiento de Productos
           ├─ Agente de Oportunidades de Producto
           ├─ Agente Inteligente de Precios
           ├─ Agente de Promociones
           ├─ Agente de Atención y Conversión
           ├─ Agente de Postventa y Reputación
           ├─ Agente de Experimentación
           ├─ Agente Investigador y Entrenador
           ├─ Agente de Memoria y Conocimiento
           ├─ Agente de Inferencia Estratégica
           ├─ Agente de Riesgo y Cumplimiento
           ├─ Agente Coordinador de Objetivos
           ├─ Agente Crítico o Abogado del Diablo
           └─ Agente Evaluador de Agentes
```

La jerarquía no es cosmética. Define quién puede investigar, quién puede solicitar evidencia, quién puede redactar una propuesta y qué decisiones deben escalarse al CEO.

### Entidades centrales de la empresa

| Entidad                      | Rol en la empresa agente                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **CEO Humano**               | Aprueba, rechaza o redirige decisiones de negocio.                                    |
| **CEO Agent**                | Coordina especialistas, sintetiza propuestas, interactúa con el CEO humano.           |
| **Directores**               | Definen prioridades de área, consolidan evidencia, escalan al CEO.                    |
| **Especialistas**            | Investigan dominios acotados, responden solicitudes de evidencia, generan propuestas. |
| **Memoria Compartida**       | Cortex: grafo neuronal con aprendizaje hebbiano y poda darwiniana.                    |
| **Memoria por Cuenta**       | Alcance de columnas `seller_id` en el modelo operacional.                             |
| **Evidencia entre Agentes**  | Solicitudes y respuestas estructuradas entre especialistas vía Agent Message Bus.     |
| **Aprendizaje**              | Aprobaciones (preferencias del CEO), resultados económicos (efectividad real).        |
| **Experimentación**          | Diseño de pruebas controladas con atribución y aprendizaje.                           |
| **Resultados Económicos**    | Relación causal entre acciones y rentabilidad real.                                   |
| **Aprobación**               | "Dale" del CEO requerido para toda mutación de negocio.                               |
| **Ejecución**                | Mutaciones con idempotencia, auditoría y posibilidad de rollback.                     |
| **Post-Observación**         | Feedback darwiniano después de verificar el resultado real.                           |
| **Retroalimentación Cortex** | Reforzar o penalizar constelaciones de activación según el outcome.                   |

### Aprendizaje humano y aprendizaje económico

MSL aprende de dos fuentes distintas:

- **Aprobación del CEO**: enseña preferencias y tolerancia al riesgo. Cuando el CEO aprueba o rechaza, Cortex refuerza o penaliza la constelación de nodos activada detrás de esa propuesta. Pero una aprobación **no debe tratarse automáticamente como una acción exitosa**.
- **Resultado económico verificado**: enseña si una acción fue efectiva. Las propuestas aprobadas y ejecutadas se evalúan contra resultados reales de venta, margen, reclamos y costos. Solo el resultado económico comprobable califica una acción como exitosa.
- **Correcciones**: cuando el CEO redirige una propuesta, la corrección se convierte en política duradera o memoria de especialista.

## Organización objetivo

> **AVISO: Esta sección describe la organización TARGET. No está implementada en su totalidad.
> Los agentes marcados con `[TARGET]` representan la visión de producto, no el estado actual del código.**

### 1. Director Financiero y Rentabilidad [TARGET]

Garantiza rentabilidad neta real con flujo de caja visible y retorno real sobre capital por cuenta, canal y período. Conecta cada acción comercial con su contribución al margen.

### 2. Agente de Resultados Económicos [TARGET]

Relaciona causalmente las acciones ejecutadas con ventas, márgenes, costos y rentabilidad. Mide el outcome económico real, no solo la ejecución. Atribuye resultados a agentes y decisiones específicas.

### 3. Agente de Lanzamiento de Productos [TARGET]

Orquesta el ciclo completo: foto → costo → stock → investigación de competencia → generación de contenido → publicación → monitoreo → aprendizaje. Conecta el Supplier Mirror con el operational read model y la ejecución en el canal objetivo.

### 4. Agente de Oportunidades de Producto [TARGET]

Descubre productos, categorías y necesidades rentables analizando datos de mercado, competencia, tendencias y señales del Supplier Mirror. Detecta gaps de oferta donde MSL puede entrar con ventaja.

### 5. Director de Portafolio [TARGET]

Decide qué productos impulsar, mantener, corregir o abandonar según rentabilidad, rotación, costo de capital, riesgo de inventario y señal de mercado. Define la estrategia de portafolio por cuenta y canal.

### 6. Agente Inteligente de Precios [TARGET]

Optimiza precios considerando margen, demanda, competencia, reputación, nivel de stock, elasticidad y estacionalidad. No aplica reglas fijas; razona con evidencia multicanal y aprende de resultados.

### 7. Agente de Promociones [TARGET]

Diseña promociones con objetivo de rentabilidad incremental, no solo volumen. Mide canibalización, adelanto de demanda y costo real de la promoción. Aprende qué tipo de promoción funciona para qué producto.

### 8. Director de Inventario, Compras e Importaciones [TARGET]

Optimiza inventario, demanda, reposición, proveedores, capital inmovilizado y landed cost. Conecta señales del Supplier Mirror con proyecciones de venta y decisiones de compra.

### 9. Agente de Atención y Conversión [TARGET]

Convierte preguntas y objeciones en ventas concretas. Responde con contexto real del producto, disponibilidad y política comercial. Aprende qué respuestas convierten y cuáles no.

### 10. Agente de Postventa y Reputación [TARGET]

Reduce reclamos, devoluciones, demoras y pérdidas de reputación. Detecta patrones de riesgo antes de que escalen. Propone acciones preventivas basadas en datos operativos reales.

### 11. Director de Crecimiento Social [TARGET]

Define estrategia de presencia en redes sociales, contenido, publishing, comunidad y atribución. Coordina agentes de contenido, experimentación y creatividad.

### 12. Agente de Experimentación [TARGET]

Diseña experimentos controlados con hipótesis clara, grupo de control, métrica de éxito y validez estadística. Evita conclusiones falsas por sesgo de selección o varianza insuficiente.

### 13. Agente Investigador y Entrenador [TARGET]

Mantiene conocimiento actualizado, fechado, atribuido y con caducidad. Investiga reglas de marketplace, términos de proveedores, benchmarks y tendencias. Transfiere conocimiento a otros agentes.

### 14. Agente de Memoria y Conocimiento [TARGET]

Gestiona los tipos de memoria de la empresa: episódica (qué pasó), semántica (qué sabemos), procedural (cómo se hace), social (quién sabe qué) y económica (qué resultado dio).

### 15. Agente de Inferencia Estratégica [TARGET]

Encuentra relaciones entre áreas que otros agentes no ven. Conecta una señal de proveedor con una oportunidad de pricing, una tendencia social con un gap de catálogo, un cambio de política con un riesgo de cumplimiento.

### 16. Director de Expansión [TARGET]

Planifica y ejecuta la entrada a nuevos canales: tienda propia, Ripley, Amazon, Alibaba, Global Selling. Evalúa cada canal por rentabilidad esperada, costo de entrada y ajuste al portafolio.

### 17. Agente de Riesgo y Cumplimiento [TARGET]

Protege el negocio sin inmovilizarlo. Detecta riesgos regulatorios, de marca, de cuenta y de canal. Propone controles proporcionados. Aprende de incidentes reales.

### 18. Agente Coordinador de Objetivos [TARGET]

Traduce la estrategia del CEO en objetivos medibles y asigna trabajo colaborativo entre agentes. Rompe objetivos grandes en work orders accionables con criterios de éxito claros.

### 19. Agente Crítico o Abogado del Diablo [TARGET]

Busca evidencia contraria y debilidades en cada propuesta antes de que llegue al CEO. Cuestiona supuestos, señala riesgos no considerados y fuerza a los otros agentes a defender su razonamiento.

### 20. Agente Evaluador de Agentes [TARGET]

Mide la calidad de predicción, el costo operativo, la contribución económica y la tasa de acierto de cada agente. Produce un scorecard que informa decisiones de scheduling, presupuesto y desarrollo.

## Ciclo de decisión

1. Un especialista detecta una oportunidad o riesgo a partir de datos operativos, señales de mercado o estrategia del CEO.
2. El especialista solicita evidencia faltante a otros agentes en lugar de adivinar. Las solicitudes fluyen por el Agent Message Bus hacia responders especializados que devuelven respuestas estructuradas con nivel de confianza.
3. El gerente combina la evidencia en una propuesta con upside esperado, costo, riesgo y confianza.
4. El CEO Agent envía solo la decisión de negocio a Telegram.
5. El CEO humano aprueba ("dale"), rechaza o redirige.
6. Cortex registra el resultado y el feedback darwiniano actualiza el comportamiento futuro.

El CEO no debe ser interrumpido para recolección rutinaria de evidencia. Debe ser interrumpido cuando hay una decisión con utilidad de negocio significativa.

## Economía de caché DeepSeek

La economía de caché de DeepSeek es una restricción de producto, no un detalle de implementación.

| Principio de caché               | Implicancia de producto                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Identidad estable del agente     | Los especialistas deben tener roles, responsabilidades y prefijos de prompt duraderos.          |
| Prefijos estables                | La identidad del negocio, políticas y reglas operativas deben permanecer cache-friendly.        |
| Políticas durables               | Las reglas que cambian con frecuencia rompen la caché y deben estar en contexto dinámico.       |
| Conocimiento duradero separado   | El conocimiento estable del dominio vive en bloques cacheados; la evidencia temporal es aparte. |
| Contexto dinámico pequeño        | Los agentes inyectan solo la evidencia necesaria para la decisión actual.                       |
| Sesiones de trabajo persistentes | Work Sessions permiten mantener contexto entre ciclos sin reenviar todo.                        |
| Evitar reenviar lo irrelevante   | Cada token innecesario que se envía es costo operativo que no genera utilidad.                  |
| Medir costo vs. utilidad         | El sistema debe saber qué agente gastó cuántos tokens, por qué y qué resultado obtuvo.          |

La empresa debe volverse más inteligente sin volverse cara de operar. El CEO Agent prefiere evidencia reciente, cacheada o de bajo costo cuando es suficiente, y pregunta antes de investigaciones caras, amplias o duplicadas.

## Camino de expansión comercial

### Canales actuales

- **Plasticov** — MercadoLibre Chile
- **Maustian** — MercadoLibre Chile

Estas cuentas son canales comerciales paralelos con precios, tipos de publicación y estrategias independientes. Una ruta de sincronización configurada (Plasticov → Maustian) es una operación acotada de seguridad, no una jerarquía de fábrica/sucursal.

### Canales objetivo [TARGET]

- Tienda propia (ecommerce con Medusa)
- Ripley marketplace
- Amazon
- Alibaba / Global Selling
- Canales sociales con atribución de venta
- Otros marketplaces justificados por rentabilidad

Cada nuevo canal debe conectarse al mismo modelo de empresa: agentes especialistas, solicitudes de evidencia, aprobación del CEO, memoria Cortex, feedback darwiniano y ruteo consciente de costos.

## Límite actual de implementación

Esta sección describe lo que está implementado y funcionando en el commit de referencia. Los detalles exactos de archivos, tool counts y PRs se documentan en [`ARCHITECTURE.md`](../ARCHITECTURE.md).

### Kernel de empresa agente — implementado

- **Agent Message Bus**: cola de mensajes asíncrona con SQLite, ciclo de claim/resolve/fail, deduplicación y prioridad.
- **14 daemon handlers**: agentes especialistas que investigan en ciclos de 15 minutos. Cada uno lee datos operativos y propone al CEO. Nunca mutan sin aprobación.
- **15 lane contracts**: definiciones tipadas de responsabilidades, entradas, salidas, límites y evidencia requerida para cada especialista.
- **Evidence Response Router**: 5 responders especializados (CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager) que responden solicitudes de evidencia entre agentes.
- **Work Sessions**: sesiones de trabajo persistentes con cooldown y ciclo de vida completo para agentes que necesitan contexto entre ejecuciones.
- **Account Assets + Account Brain**: cada cuenta de MercadoLibre es un activo estratégico con sus propias capacidades, riesgos, oportunidades y objetivo de rentabilidad.
- **Cortex**: grafo neuronal en SQLite con aprendizaje hebbiano, poda darwiniana y propagación de activación por CTEs recursivas.
- **DeepSeek**: cliente real con bloques de caché estables, disponible con `DEEPSEEK_API_KEY`.
- **Operational Read Model**: snapshots SQLite de 8 tipos de entidad (listings, claims, questions, orders, messages, reputation, product-ads-insights, pricing).
- **Supplier Mirror**: evidencia de proveedores local-first, políticas de target, adaptadores de fuente y dry-run de Jinpeng.
- **Owned Ecommerce**: runtime con write boundary de Medusa (fail-closed), proyecciones de storefront y preview adapter. Activación controlada por variables de entorno.
- **Creative Studio**: generación de imágenes y video con MiniMax, control de presupuesto y políticas. Activación controlada por variables de entorno.
- **Telegram Bot**: runtime con grammY, CEO-only, multi-seller.
- **MCP Server**: ~40 herramientas para clientes MCP.
- **Aprobación "dale"**: toda mutación requiere aprobación explícita.
- **Aislamiento por cuenta**: alcance de columnas `seller_id` en el modelo operacional y la memoria.

### Pendiente de producción

- **Credenciales reales de ML OAuth**: el OAuth manager está en modo stub. Sin `MERCADOLIBRE_CLIENT_ID`/`MERCADOLIBRE_CLIENT_SECRET` no hay ingesta real.
- **Ingesta real**: los procesadores de background ingestion existen pero requieren credenciales reales para funcionar.
- **Transporte real**: varios componentes usan transporte fake/mock pendiente de reemplazo con credenciales.
- **Ecommerce productivo**: el write boundary de Medusa está implementado pero no activo sin credenciales.
- **Canales sociales**: no implementados.
- **Expansión multicanal**: no implementada.

## Material relacionado

- [`README.md`](../README.md) — introducción y uso actual
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — arquitectura implementada
- [`ROADMAP.md`](../ROADMAP.md) — capacidades pendientes y prioridades
- [`docs/propuesta-ceo-socio.md`](./propuesta-ceo-socio.md) — material histórico de propuesta inicial
- [`docs/PHILOSOPHY.md`](./PHILOSOPHY.md) — filosofía de ingeniería
