import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { MapPage } from './pages/MapPage'
import { AssignmentsPage } from './pages/AssignmentsPage'
import { SatelliteDetailsPage } from './pages/SatelliteDetailsPage'
import { TelescopeDetailsPage } from './pages/TelescopeDetailsPage'
import { Globe3DPage } from './pages/Globe3DPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/satellites/:noradId" element={<SatelliteDetailsPage />} />
          <Route path="/telescopes/:code" element={<TelescopeDetailsPage />} />
          <Route path="/globe" element={<Globe3DPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
