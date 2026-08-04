import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(currentDirectory, relativePath), 'utf8')
}

describe('application routing contracts', () => {
  it('renders a deliberate product 404 instead of redirecting unknown routes home', async () => {
    const app = await readSource('App.tsx')

    expect(app).toContain("import { NotFoundPage } from './pages/not-found/NotFoundPage'")
    expect(app).toContain("{ path: '*', element: <NotFoundPage /> }")
    expect(app).not.toContain("<Navigate to='/' replace />")
  })

  it('offers an accessible route back to the workspace', async () => {
    const notFoundPage = await readSource('pages/not-found/NotFoundPage.tsx')

    expect(notFoundPage).toContain("aria-labelledby='not-found-title'")
    expect(notFoundPage).toContain("id='not-found-title'")
    expect(notFoundPage).toContain('404')
    expect(notFoundPage).toContain("to='/'")
    expect(notFoundPage).toContain('返回工作台')
  })

  it('makes the project-scoped Agent workspace a first-class authenticated route', async () => {
    const app = await readSource('App.tsx')
    const projectCard = await readSource('components/project/ProjectCard.tsx')
    const projectsPage = await readSource('pages/projects/ProjectsPage.tsx')

    expect(app).toContain("path: '/projects/:projectId/agent/:conversationId?'")
    expect(app).toContain('<ProjectAgent />')
    expect(projectCard).toContain('to={`/projects/${project.id}/agent`}')
    expect(projectsPage).toContain('navigate(`/projects/${project.id}/agent`)')
  })
})
