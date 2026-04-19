import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { TerminalDemo } from "@/components/landing/TerminalDemo";
import { Features } from "@/components/landing/Features";
import { Marquee } from "@/components/landing/Marquee";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export function Landing() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-green focus:text-bg-primary focus:px-4 focus:py-2 focus:rounded focus:font-mono focus:text-sm"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content">
        <Hero />
        <section id="how">
          <TerminalDemo />
        </section>
        <Features />
        <Marquee />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
