export function PreviewState({
  title,
  detail,
  action,
}: {
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className='grid h-full min-h-screen w-full place-items-center bg-[#080A0D] p-6 text-[#F1F5F7]'>
      <div className='border border-[#2A333D] bg-[#0F1318] px-6 py-5 text-center'>
        <p className='text-sm font-medium'>{title}</p>
        {detail ? <p className='mt-2 max-w-md text-xs text-[#8D99A3]'>{detail}</p> : null}
        {action ? <div className='mt-4'>{action}</div> : null}
      </div>
    </div>
  )
}
