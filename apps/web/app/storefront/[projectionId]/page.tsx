import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  formatProjectionPrice,
  listStoredProjectionIds,
  loadStoredProjectionResult,
} from "./projectionLoader";

export const revalidate = 300;
export const dynamicParams = false;

type PageProps = { params: Promise<{ projectionId: string }> };

export async function generateStaticParams(): Promise<Array<{ projectionId: string }>> {
  return listStoredProjectionIds();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectionId } = await params;
  const result = await loadStoredProjectionResult(projectionId);
  if (result.status !== "found") return { title: "Storefront projection not found" };

  return {
    title: result.projection.content.seoTitle,
    description: result.projection.content.geoCopy,
  };
}

export default async function StorefrontProjectionPage({ params }: PageProps) {
  const { projectionId } = await params;
  const result = await loadStoredProjectionResult(projectionId);
  if (result.status !== "found") {
    if (result.status === "invalid") {
      console.error("Invalid storefront projection data", { projectionId, reason: result.reason });
    }
    notFound();
  }
  const { projection } = result;
  const heroMedia = projection.media.find((item) => item.priority) ?? projection.media[0];

  return (
    <main className="shell">
      <section className="hero">
        {heroMedia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={heroMedia.alt}
            height={heroMedia.height}
            src={heroMedia.src}
            style={{ borderRadius: 20, height: "auto", width: "100%" }}
            width={heroMedia.width}
          />
        ) : null}
        <p className="eyebrow">Stored storefront projection</p>
        <h1>{projection.content.seoTitle}</h1>
        <p>{projection.content.geoCopy}</p>
        <p>
          Preview status: <strong>{projection.status}</strong> · Revalidated every {revalidate}{" "}
          seconds · Projection generated at: {projection.generatedAt}
        </p>
      </section>

      <section className="grid" aria-label="Projection readiness and catalog">
        <article className="card">
          <h2>Readiness</h2>
          <p>Status: {projection.readiness.status}</p>
          <p>Generated: {projection.readiness.generatedAt}</p>
          {projection.readiness.checks.length > 0 ? (
            <ul>
              {projection.readiness.checks.map((check) => (
                <li key={check.code}>
                  {check.code}: {check.redactedMessage}
                </li>
              ))}
            </ul>
          ) : (
            <p>No blocking checks stored in this projection.</p>
          )}
        </article>

        <article className="card">
          <h2>Evidence</h2>
          <ul>
            {projection.evidenceIds.map((evidenceId) => (
              <li key={evidenceId}>{evidenceId}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid" aria-label="Catalog products">
        {projection.catalog.products.map((product) => (
          <article className="card" key={product.handle}>
            <h2>{product.title}</h2>
            <p>{product.description}</p>
            <ul>
              {product.variants.map((variant) => (
                <li key={variant.sku}>
                  {variant.title}: {formatProjectionPrice(variant.price, variant.currency)} ·
                  Evidence:
                  {variant.evidenceIds.join(", ")}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="card wide">
        <h2>Evidence-backed claims</h2>
        <ul>
          {projection.content.claims
            .filter((claim) => claim.status !== "blocked")
            .map((claim) => (
              <li key={claim.id}>
                {claim.text} Evidence: {claim.evidenceIds.join(", ")}
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
