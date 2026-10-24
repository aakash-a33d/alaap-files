import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Landing from '../pages/public/Landing'

/* The forum page is a separate chunk — the landing page is the common entry
   and should not pay to download a route most visitors never open. */
const Community = lazy(() => import('../pages/community/Community'))
/* Two paths, one component. Create and sign in are different enough to deserve
   their own URLs — linkable, and the back button steps between them. */
const Join = lazy(() => import('../pages/auth/Join'))
/* The member's home once they are in. Its own chunk — visitors never load it. */
const Dashboard = lazy(() => import('../pages/dashboard/Dashboard'))

export function Router() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/community" element={<Community />} />
          <Route path="/community/:slug" element={<Community />} />
          <Route path="/join" element={<Join />} />
          <Route path="/signin" element={<Join />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
