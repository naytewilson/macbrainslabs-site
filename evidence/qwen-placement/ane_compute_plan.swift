import Foundation
import CoreML

@available(macOS 14.4, *)
func walk(_ s: MLModelStructure, _ plan: MLComputePlan,
          _ tally: inout [String:Int], _ total: inout Int,
          _ byType: inout [String:[String:Int]], _ onlyFn: String?) {
    switch s {
    case .program(let prog):
        for (name, fn) in prog.functions where onlyFn == nil || name == onlyFn {
            for op in fn.block.operations {
                total += 1
                let name: String
                if let usage = plan.deviceUsage(for: op) {
                    switch usage.preferred {
                    case .cpu: name = "CPU"
                    case .gpu: name = "GPU"
                    case .neuralEngine: name = "ANE"
                    @unknown default: name = "?"
                    }
                } else { name = "none" }
                tally[name, default: 0] += 1
                byType[name, default: [:]][op.operatorName, default: 0] += 1
            }
        }
    case .neuralNetwork: tally["nn(legacy)", default:0]+=1
    case .pipeline: tally["pipeline", default:0]+=1
    case .unsupported: tally["unsupported", default:0]+=1
    @unknown default: break
    }
}

let path = CommandLine.arguments[1]
// Optional 2nd arg = function name for per-function placement (multi-function models:
// infer/prefill/verify). Without it, the plan defaults to the primary function and
// non-primary functions' ops report no device usage. With it, target THAT function.
let targetFn: String? = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
let sem = DispatchSemaphore(value: 0)
// Swift 6: detached (never inherits MainActor from top level — a plain Task
// here would deadlock against sem.wait() below when its await resumes).
Task.detached {
    // Build the non-Sendable config inside the task instead of sending it
    // across isolation (same values, no shared mutation).
    let cfg = MLModelConfiguration(); cfg.computeUnits = .cpuAndNeuralEngine
    if let f = targetFn { cfg.functionName = f }
    do {
        let plan = try await MLComputePlan.load(contentsOf: URL(fileURLWithPath: path), configuration: cfg)
        var tally: [String:Int] = [:]; var total = 0
        var byType: [String:[String:Int]] = [:]
        if #available(macOS 14.4, *) { walk(plan.modelStructure, plan, &tally, &total, &byType, targetFn) }
        print("model: \(path)\(targetFn.map { "  function: \($0)" } ?? "  (all functions)")")
        print("total ops: \(total)")
        for (k,v) in tally.sorted(by: {$0.value>$1.value}) {
            print(String(format: "  %-10@ %6d  (%.1f%%)", k as NSString, v, total>0 ? Double(v)*100/Double(total):0))
        }
        // compute-only split (exclude const-style buckets)
        let compute = (tally["ANE"] ?? 0) + (tally["GPU"] ?? 0) + (tally["CPU"] ?? 0)
        if compute > 0 {
            print("\n=== assigned-compute ops only (ANE+CPU+GPU = \(compute)) ===")
            for k in ["ANE","CPU","GPU"] {
                let v = tally[k] ?? 0
                print(String(format: "  %-4@ %5d  (%.1f%% of compute)", k as NSString, v, Double(v)*100/Double(compute)))
            }
        }
        // prove what 'none' is: top op types per bucket
        for bucket in ["none","ANE","CPU"] {
            guard let m = byType[bucket], !m.isEmpty else { continue }
            print("\n=== top op types in '\(bucket)' ===")
            for (t,c) in m.sorted(by: {$0.value>$1.value}).prefix(8) {
                print(String(format: "  %-22@ %d", t as NSString, c))
            }
        }
    } catch { print("ERR: \(error)") }
    sem.signal()
}
sem.wait()
