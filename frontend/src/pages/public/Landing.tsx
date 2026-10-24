import { Nav } from '../../components/layout/Nav'
import { Hero } from './sections/Hero'
import { TrustStrip } from './sections/TrustStrip'
import { Beats } from './sections/Beats'
import { HowItWorks } from './sections/HowItWorks'
import { LivePosts } from './sections/LivePosts'
import { Privacy } from './sections/Privacy'
import { Shield } from './sections/Shield'
import { ConsentStudio } from './sections/ConsentStudio'
import { AITransparency } from './sections/AITransparency'
import { Pricing } from './sections/Pricing'
import { Safety } from './sections/Safety'
import { FAQ } from './sections/FAQ'
import { FinalCTA } from './sections/FinalCTA'
import { Footer } from './sections/Footer'

export default function Landing() {
  return (
    <>
      <Nav />

      <main id="main">
        <Hero />
        {/* Marks the end of the pinned hero for the nav's theme switch. */}
        <div id="hero-end" aria-hidden="true" className="h-px w-full" />
        {/* Theme alternates deliberately: no two adjacent bands share a
            ground, which is what stops the page reading as one long article. */}
        <TrustStrip />
        <Beats />
        <Shield />
        <HowItWorks />
        <LivePosts />
        <ConsentStudio />
        <Privacy />
        <AITransparency />
        <Pricing />
        <Safety />
        <FAQ />
        <FinalCTA />
      </main>

      <Footer />
    </>
  )
}
