"use client"

import { LocaleProvider } from "./locale-provider"
import { Header } from "./header"
import { Hero } from "./hero"
import { StrategyAuthoring } from "./strategy-authoring"
import { Intelligence } from "./intelligence"
import { Execution } from "./execution"
import { HowItWorks } from "./how-it-works"
import { DeveloperExperience } from "./developer-experience"
import { FinalCta } from "./final-cta"
import { Footer } from "./footer"

export function LandingPage() {
  return (
    <LocaleProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main>
          <Hero />
          <StrategyAuthoring />
          <Intelligence />
          <Execution />
          <HowItWorks />
          <DeveloperExperience />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </LocaleProvider>
  )
}
