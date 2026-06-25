import { DemoConsole } from "./demo-console";
import { buildDemoViewModel } from "./demo";

export default async function Home() {
  const demo = await buildDemoViewModel();

  return <DemoConsole demo={demo} />;
}
