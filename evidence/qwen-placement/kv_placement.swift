import Foundation
import CoreML

// Tallies device placement (ANE/CPU/GPU) of the KV-cache machinery ops in a compiled
// .mlmodelc, per function. Proves dynamic-position KV read/write lands on the ANE.
@available(macOS 14.4, *)
func dev(_ plan: MLComputePlan, _ op: MLModelStructure.Program.Operation) -> String {
    guard let u = plan.deviceUsage(for: op) else { return "none" }
    switch u.preferred {
    case .cpu: return "CPU"; case .gpu: return "GPU"; case .neuralEngine: return "ANE"
    @unknown default: return "?" }
}
let path = CommandLine.arguments[1]
let fn = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
let watch = ["slice_update","read_state","write_state","coreml_update_state","slice_by_index","gather","gather_along_axis","scatter"]
let sem = DispatchSemaphore(value: 0)
// Swift 6: detached (never inherits MainActor from top level — a plain Task
// here would deadlock against sem.wait() below when its await resumes).
Task.detached {
    // Build the non-Sendable config inside the task instead of sending it
    // across isolation (same values, no shared mutation).
    let cfg = MLModelConfiguration(); cfg.computeUnits = .cpuAndNeuralEngine
    if let f = fn { cfg.functionName = f }
    do {
        let plan = try await MLComputePlan.load(contentsOf: URL(fileURLWithPath: path), configuration: cfg)
        var tally: [String:[String:Int]] = [:]
        if #available(macOS 14.4, *), case let .program(prog) = plan.modelStructure {
            for (name, f) in prog.functions where fn == nil || name == fn {
                for op in f.block.operations {
                    let base = op.operatorName.replacingOccurrences(of: "ios18.", with: "")
                                              .replacingOccurrences(of: "ios17.", with: "")
                                              .replacingOccurrences(of: "ios16.", with: "")
                    if watch.contains(base) { tally[base, default:[:]][dev(plan, op), default:0] += 1 }
                }
            }
        }
        print("KV-machinery placement  (model: \(path)\(fn.map{"  fn:\($0)"} ?? ""))")
        for op in watch {
            guard let m = tally[op] else { continue }
            let s = m.sorted{$0.value>$1.value}.map{"\($0.key)=\($0.value)"}.joined(separator: "  ")
            print(String(format: "  %-20@ %@", op as NSString, s))
        }
    } catch { print("ERR: \(error)") }
    sem.signal()
}
sem.wait()
