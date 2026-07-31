import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BasicInfoSection } from './BasicInfoSection'
import { FunctionConfigSection } from './FunctionConfigSection'
import { RequestConfigSection } from './RequestConfigSection'
import { createDefaultFormData } from './constants'
import { formDataToDataSourceConfig, parseDataSourceToFormData } from './formUtils'
import type { DataSourceEditorModalProps, DataSourceFormData } from './types'

export const DataSourceEditorModal = observer((props: DataSourceEditorModalProps) => {
  const { dataSource, open, onConfirm, onClose, children } = props
  const isEdit = !!dataSource?.id

  const [formData, setFormData] = useState<DataSourceFormData>(createDefaultFormData)

  useEffect(() => {
    if (dataSource) {
      setFormData(parseDataSourceToFormData(dataSource))
    } else {
      setFormData(createDefaultFormData())
    }
  }, [dataSource])

  const updateField = <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const updateArrayField = (field: 'params' | 'headers', index: number, key: 'key' | 'value', value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }))
  }

  const addArrayItem = (field: 'params' | 'headers') => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], { key: '', value: '' }],
    }))
  }

  const removeArrayItem = (field: 'params' | 'headers', index: number) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }))
  }

  const handleConfirm = () => {
    const { config, error } = formDataToDataSourceConfig(formData)

    if (error) {
      toast.warning(error)
      return
    }

    if (config) {
      onConfirm?.(config)
      onClose?.()
    }
  }

  const handleClose = () => {
    if (!isEdit) {
      setFormData(createDefaultFormData())
    }
    onClose?.()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {children}
      <DialogContent className='!max-w-[1200px] max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>数据源{isEdit ? `编辑 - ${formData.id}` : '新增'}</DialogTitle>
          <DialogDescription>配置数据源的基础信息、请求参数和数据处理函数。</DialogDescription>
        </DialogHeader>
        <div className='mt-2 flex flex-col gap-4'>
          <BasicInfoSection formData={formData} isEdit={isEdit} updateField={updateField} />

          <RequestConfigSection
            formData={formData}
            updateField={updateField}
            updateArrayField={updateArrayField}
            addArrayItem={addArrayItem}
            removeArrayItem={removeArrayItem}
          />

          <FunctionConfigSection formData={formData} updateField={updateField} />
        </div>
        <DialogFooter>
          <Button type='submit' onClick={handleConfirm} className='h-8 text-xs px-4 py-[5px]'>
            确定
          </Button>
          <Button variant='outline' onClick={handleClose} className='h-8 text-xs px-4 py-[5px]'>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export type { DataSourceEditorModalProps } from './types'
