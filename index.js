(function init() {
    class ThreadPlanner {
        constructor() {
            /** @type {Map<number, function[]>} */
            this.freeThreads = new Map()
            /** @type {[{resolve, reject}, Function, string[]][]} */
            this.threadQueue = []
            this.numberOfRunningThreads = 0
            this.maxThreads = 1 //Will be determined by extended classes
            this.currentID = -1
            this.metaData = new Map()
        }

        getNextID() {
            return ++this.currentID
        }

        createInlineWorker(functionToInline) {
            //Implemented in extended classes
        }

        executeWorker(worker, ...args) {
            return new Promise((resolve, reject) => {
                worker.onmessage = (result) => {
                    resolve(result.data)
                }
                worker.onerror = reject
                worker.postMessage(args)
            })
        }

        terminate(fn) {
            if (this.freeThreads.has(fn.threadID)) {
                this.freeThreads.get(fn.threadID).forEach(worker => {
                    worker.terminate()
                })
                this.freeThreads.delete(fn.threadID)
            }
        }

        next() {
            if (this.threadQueue.length) {
                const nextItem = this.threadQueue.splice(0, 1)[0]
                this.runThread(nextItem[1], ...nextItem[2])
                    .then(result => {
                        nextItem[0].resolve(result)
                    })
                    .catch(error => {
                        nextItem[0].reject(error)
                    })
            }
        }

        async run(fn, ...args) {
            if (!this.metaData.has(fn.threadID)) {
                this.metaData.set(fn.threadID, {
                    pendingTasks: 0,
                    terminationTimeout: undefined
                })
            }
            const metaData = this.metaData.get(fn.threadID)
            if (metaData.terminationTimeout) {
                clearTimeout(metaData.terminationTimeout)
                delete metaData.terminationTimeout
            }
            metaData.pendingTasks++
            const result = threadPlanner.runThread(fn, ...args)
            return result
        }

        async runThread(fn, ...args) {
            let resolve
            let reject
            const result = new Promise((outerResolve, outerReject) => {
                resolve = outerResolve
                reject = outerReject
            })
            if (!this.freeThreads.has(fn.threadID)) {
                this.freeThreads.set(fn.threadID, [])
            }
            if (this.numberOfRunningThreads === this.maxThreads) {
                this.threadQueue.push([{ resolve, reject }, fn, [...args]])
                return result
            }
            const threads = this.freeThreads.get(fn.threadID)
            if (!threads.length) {
                threads.push(this.createInlineWorker(fn))
            }
            const thread = threads.splice(0, 1)[0]
            this.numberOfRunningThreads++
            this.executeWorker(thread, ...args)
                .then(executionResult => {
                    const metaData = this.metaData.get(fn.threadID)
                    this.freeThreads.get(fn.threadID).push(thread)
                    this.numberOfRunningThreads--
                    metaData.pendingTasks--
                    if (!metaData.pendingTasks) {
                        metaData.terminationTimeout = setTimeout(() => {
                            this.terminate(fn)
                        }, 10000)
                    }
                    this.next()
                    resolve(executionResult)
                })
                .catch(error => {
                    this.freeThreads.get(fn.threadID).push(thread)
                    this.numberOfRunningThreads--
                    const metaData = this.metaData.get(fn.threadID)
                    metaData.pendingTasks--
                    if (!metaData.pendingTasks) {
                        metaData.terminationTimeout = setTimeout(() => {
                            this.terminate(fn)
                        }, 10000)
                    }
                    this.next()
                    reject(error)
                })
            return result
        }
    }

    class BrowserThreadPlanner extends ThreadPlanner {
        constructor(...args) {
            super(...args)
            this.maxThreads = navigator.hardwareConcurrency - 1
        }

        createInlineWorker(functionToInline) {
            const functionString = functionToInline.toString()
            const args = functionString.substring(functionString.indexOf("(") + 1, functionString.indexOf(")"))
            const content = functionString.substring(functionString.indexOf("{") + 1, functionString.lastIndexOf("}"))
            const code = `
        function execute(${args}) {
            ${content}
        }
            self.onmessage = async (params) => {
                let result = execute(...params.data)
                if(result instanceof Promise) {
                    result = await result
                }
            postMessage(result)
        }
    `
            const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
            return worker
        }

    }

    class NodeThreadPlanner extends ThreadPlanner {
        constructor(...args) {
            super(...args)
            this.maxThreads = require("os").cpus().length - 1
            this.Worker = require("worker_threads").Worker
        }

        createInlineWorker(functionToInline) {
            const functionString = functionToInline.toString()
            const args = functionString.substring(functionString.indexOf("(") + 1, functionString.indexOf(")"))
            const content = functionString.substring(functionString.indexOf("{") + 1, functionString.lastIndexOf("}"))
            const code = `
        const { workerData, parentPort } = require("worker_threads")
        function execute(${args}) {
            ${content}
        }
        parentPort.on("message", async (params) => {
            let result = execute(...params)
            if(result instanceof Promise) {
                result = await result
            }
            parentPort.postMessage(result)
        })
        `
            const workerInterface = {}
            const worker = new this.Worker(code, { eval: true })
            worker.on("message", (message) => workerInterface.onmessage({ data: message }))
            worker.on("error", (...args) => workerInterface.onerror(...args))
            workerInterface.postMessage = (...args) => worker.postMessage(...args)
            workerInterface.terminate = () => worker.terminate()
            workerInterface.worker = worker
            return workerInterface
        }

    }

    let threadPlanner
    if (typeof window === "undefined") {
        threadPlanner = new NodeThreadPlanner()
    }
    else {
        threadPlanner = new BrowserThreadPlanner()
    }

    Function.prototype.runThread = function (...args) {
        if (!this.threadID) {
            this.threadID = threadPlanner.getNextID()
        }
        return threadPlanner.run(this, ...args)
    }

    Function.prototype.terminateThreads = function () {
        threadPlanner.terminate(this)
    }

})()