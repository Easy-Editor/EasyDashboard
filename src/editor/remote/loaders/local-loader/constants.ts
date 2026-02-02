/** 调试物料分组名称 */
export const DEBUG_GROUP = 'DEBUG'

/** WebSocket 重连配置 */
export const WS_RECONNECT_CONFIG = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
} as const
