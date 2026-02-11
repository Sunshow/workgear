import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { MainLayout } from './components/layout/main-layout'
import { ProjectsPage } from './pages/projects'
import { BoardPage } from './pages/board'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/board" element={<BoardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
