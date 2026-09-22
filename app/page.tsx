import styles from "./page.module.css";
import { CapabilityGrid } from "@/components/marketing/capability-grid";
import { ChangeExamples } from "@/components/marketing/change-examples";
import { ChangeRecordPreview } from "@/components/marketing/change-record-preview";
import { ComparisonSection } from "@/components/marketing/comparison-section";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";
import { Header } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { MonitoringScopePreview } from "@/components/marketing/monitoring-scope-preview";
import { WatchlistUseCases } from "@/components/marketing/watchlist-use-cases";
import { Workflow } from "@/components/marketing/workflow";

export default function Home() {
  return (
    <div className={styles.page}>
      <Header />
      <main>
        <Hero />
        <ChangeExamples />
        <Workflow />
        <MonitoringScopePreview />
        <CapabilityGrid />
        <ChangeRecordPreview />
        <WatchlistUseCases />
        <ComparisonSection />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
