import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EventBindModal } from './EventBindModal'

describe('EventBindModal', () => {
  it.each([undefined, null])('renders without throwing when methods is %s', methods => {
    expect(() =>
      renderToStaticMarkup(
        <EventBindModal open={false} setOpen={() => undefined} methods={methods}>
          <span>事件配置</span>
        </EventBindModal>,
      ),
    ).not.toThrow()
  })
})
