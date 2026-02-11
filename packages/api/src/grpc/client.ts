import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.resolve(__dirname, '../../../shared/proto/orchestrator.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const proto = grpc.loadPackageDefinition(packageDefinition) as any

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'localhost:50051'

// Create gRPC client
const client = new proto.orchestrator.OrchestratorService(
  ORCHESTRATOR_URL,
  grpc.credentials.createInsecure(),
)

// ─── Promisified client methods ───

export function startFlow(flowRunId: string, workflowDsl: string, variables: Record<string, string>, taskId: string, workflowId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.StartFlow({ flowRunId, workflowDsl, variables, taskId, workflowId }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function cancelFlow(flowRunId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.CancelFlow({ flowRunId }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function approveNode(nodeRunId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.ApproveNode({ nodeRunId }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function rejectNode(nodeRunId: string, feedback: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.RejectNode({ nodeRunId, feedback }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function editNode(nodeRunId: string, editedContent: string, changeSummary: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.EditNode({ nodeRunId, editedContent, changeSummary }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function submitHumanInput(nodeRunId: string, dataJson: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.SubmitHumanInput({ nodeRunId, dataJson }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

export function retryNode(nodeRunId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    client.RetryNode({ nodeRunId }, (err: any, response: any) => {
      if (err) return reject(err)
      resolve(response)
    })
  })
}

// ─── Event Stream ───

export interface ServerEvent {
  eventType: string
  flowRunId: string
  nodeRunId: string
  nodeId: string
  dataJson: string
  timestamp: string
}

export function subscribeEvents(flowRunId?: string, onEvent?: (event: ServerEvent) => void, onError?: (err: Error) => void): { cancel: () => void } {
  const stream = client.EventStream({ flowRunId: flowRunId || '' })

  stream.on('data', (event: ServerEvent) => {
    onEvent?.(event)
  })

  stream.on('error', (err: Error) => {
    // gRPC CANCELLED is expected on shutdown
    if ((err as any).code !== grpc.status.CANCELLED) {
      onError?.(err)
    }
  })

  stream.on('end', () => {
    // Stream ended, could reconnect here
  })

  return {
    cancel: () => stream.cancel(),
  }
}
