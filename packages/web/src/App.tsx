import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { MainLayout } from './components/layout/main-layout'
import { AuthGuard } from './components/auth-guard'
import { LoginPage } from './pages/auth/login'
import { RegisterPage } from './pages/auth/register'
import { ProjectsPage } from './pages/projects'
import { KanbanPage } from './pages/kanban'
import { WorkflowsPage } from './pages/workflows'
import { WorkflowEditorPage } from './pages/workflows/workflow-editor'
import { ExplorePage } from './pages/explore'
import { AgentRolesPage } from './pages/settings/agent-roles'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 需登录的路由 */}
        <Route path="/" element={<AuthGuard><MainLayout /></AuthGuard>}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/kanban" element={<KanbanPage />} />
          <Route path="projects/:projectId/workflows" element={<WorkflowsPage />} />
          <Route path="projects/:projectId/workflows/:workflowId/edit" element={<WorkflowEditorPage />} />
          <Route path="settings/agent-roles" element={<AgentRolesPage />} />
          <Route path="explore" element={<ExplorePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
