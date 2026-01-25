import { saveProjectSchemaToLocalStorage } from '@/lib/schema'
import { type Project, TRANSFORM_STAGE } from '@easy-editor/core'
import { toast } from 'sonner'

export const createProjectHandlers = (project: Project) => ({
  save: () => {
    const schema = project.export(TRANSFORM_STAGE.SAVE)
    saveProjectSchemaToLocalStorage(schema)
    toast.success('保存成功')
  },
})
