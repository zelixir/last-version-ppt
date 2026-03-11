import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Models from './pages/Models'
import Project from './pages/Project'
import Help from './pages/Help'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects/:projectId" element={<Project />} />
        <Route path="/models" element={<Models />} />
        <Route path="/help" element={<Help />} />
      </Routes>
    </BrowserRouter>
  )
}
