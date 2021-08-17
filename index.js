(function init() {
    class ThreadPlanner {
        constructor() {
            /** A list of queued jobs. The first item is the promise that is waiting for the resolution of the thread. The second is the function to execute, and the third is a list of arguments. */
            this.threadQueue = []
            /** Currently running number of threads */
            this.numberOfRunningThreads = 0
            /** Maximum allowed number of threads (determined in extending classes) */
            this.maxThreads = -1
            /** A map between functions and information about how many tasks are currently pending, a timeout object used to keep track of worker idle time for auto-termination, worker dependencies, as well as free worker threads. */
            this.metaData = new WeakMap()
            /** Maximum idle time before workers are terminated (in ms) */
            this.MAXIMUM_IDLE_TIME_MS = 10000 //10 seconds
        }

        getMaxThreadCount() {
            return this.maxThreads
        }

        setMaxThreadCount(maxThreadCount) {
            this.maxThreads = maxThreadCount
        }

        setThreadMaxIdleTime(maxIdleTime) {
            this.MAXIMUM_IDLE_TIME_MS = maxIdleTime
        }

        hasNext() {
            return !!this.threadQueue.length
        }

        createInlineWorker(fn, dependencyString) {
            return this.createInlineWorker(fn, dependencyString)
        }

        /**
         * Terminates all workers for a given function
         * @param fn - Function for which workers should be terminated
         */
        terminate(fn) {
            if (this.metaData.has(fn)) {
                const meta = this.metaData.get(fn)
                if (meta.terminationTimeout) {
                    clearTimeout(meta.terminationTimeout)
                }
                meta.freeThreads.forEach(worker => {
                    worker.terminate()
                })
                this.metaData.delete(fn)
            }
            this.threadQueue.filter(thread => thread[1] === fn).forEach(thread => thread[0].reject("Thread was terminated."))
            this.threadQueue = this.threadQueue.filter(thread => thread[1] !== fn)
        }

        /**
         * Recursively computes a dependency string for a given function
         * @param obj - Object to compute dependency string for
         * @param result - Should never be set externally! Recursively updated dependency string
         */
        getDependencyString(obj, result = "") {
            if (obj._needlework && obj._needlework.dependencyString) {
                result += `${obj._needlework.dependencyString}
			
			`
            }
            if (obj._needlework && obj._needlework.dependencies) {
                const dependencies = obj._needlework.dependencies
                Object.keys(dependencies).forEach(key => {
                    const dependency = dependencies[key]
                    result += `var ${key} = ${dependency.toString ? dependency.toString() : dependency}
				
				`
                    result = this.getDependencyString(dependency, result)
                })
            }
            return result
        }

        /**
         * Queues a function in the thread planner (and starts a thread execution loop if possible). 
         * @param fn - Function to run
         * @param args - Arguments for the function
         */
        async run(fn, ...args) {
            if (!this.metaData.has(fn)) {
                this.metaData.set(fn, {
                    pendingTasks: 0,
                    terminationTimeout: undefined,
                    dependencyString: this.getDependencyString(fn),
                    freeThreads: []
                })
            }
            const metaData = this.metaData.get(fn)
            if (metaData.terminationTimeout) {
                clearTimeout(metaData.terminationTimeout)
                delete metaData.terminationTimeout
            }
            metaData.pendingTasks++
            let resolve
            let reject
            const result = new Promise((outerResolve, outerReject) => {
                resolve = outerResolve
                reject = outerReject
            })
            this.threadQueue.push([{ resolve, reject }, fn, [...args]])
            if (this.numberOfRunningThreads !== this.maxThreads) {
                //There should never be more execution loops than max thread count.
                this.executeQueueLoop()
            }
            return result
        }

        /**
         * Executes threads one by one until the queue is empty.
         * @param fn - Function to execute
         * @param args - Arguments for the function to be executed
         */
        async executeQueueLoop() {
            while (this.hasNext()) {
                const nextItem = this.threadQueue.splice(0, 1)[0]
                const resolve = nextItem[0].resolve
                const reject = nextItem[0].reject
                const fn = nextItem[1]
                const args = nextItem[2]
                const threads = this.metaData.get(fn).freeThreads
                if (!threads.length) {
                    threads.push(this.createInlineWorker(fn, this.metaData.get(fn).dependencyString))
                }
                const thread = threads.splice(0, 1)[0]
                this.numberOfRunningThreads++
                try {
                    await this.executeWorker(thread, ...args)
                        .then(executionResult => {
                            this.handleThreadCompleted(fn, thread)
                            resolve(executionResult)
                        })
                        .catch(error => {
                            this.handleThreadCompleted(fn, thread)
                            reject(error)
                        })
                } catch (e) {
                    console.error(e)
                }
                this.numberOfRunningThreads--
            }
        }

        /**
         * Executes a worker and returns a promise with the result
         * @param worker - Worker to be executed
         * @param args - arguments for the worker
         */
        executeWorker(worker, ...args) {
            return new Promise((resolve, reject) => {
                worker.onmessage = result => {
                    resolve(result.data)
                }
                worker.onerror = reject
                worker.postMessage(args)
            })
        }

        /**
         * Handles when a worker completes an operation
         * @param fn - Function that completed
         * @param thread - Worker that completed
         */
        handleThreadCompleted(fn, thread) {
            const metaData = this.metaData.get(fn)
            metaData.freeThreads.push(thread)
            metaData.pendingTasks--
            if (!metaData.pendingTasks) {
                if (this.MAXIMUM_IDLE_TIME_MS) {
                    metaData.terminationTimeout = setTimeout(() => {
                        this.terminate(fn)
                    }, this.MAXIMUM_IDLE_TIME_MS)
                }
            }
        }
    }

    class BrowserThreadPlanner extends ThreadPlanner {
        constructor() {
            super()
            this.maxThreads = Math.max(navigator.hardwareConcurrency - 1, 1)
        }

        /**
         * Creates a Worker object from a given function by serializing it to a string
         * @param fn - Function to be inlined
         */
        createInlineWorker(fn, dependencyString) {
            const functionString = fn.toString()
            const args = functionString.substring(functionString.indexOf("(") + 1, functionString.indexOf(")"))
            const content = functionString.substring(functionString.indexOf("{") + 1, functionString.lastIndexOf("}"))
            const code = `
            ${dependencyString}
    
            function execute(${args}) {
                ${content}
            }
                self.onmessage = async (params) => {
                    let result = []
                    for(let i = 0; i < params.length; i++) {
                        result.push(execute(...params[i]))
                    }
                    for(let i = 0; i < params.length; i++)
                    if(result[i] instanceof Promise) {
                        result[i] = await result[i]
                    }
                    postMessage(result)
            }
        `
            const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
            return worker
        }
    }

    class NodeThreadPlanner extends ThreadPlanner {
        constructor() {
            super()
            this.maxThreads = Math.max(require("os").cpus().length - 1, 1)
            this.Worker = require("worker_threads").Worker
        }

        createInlineWorker(fn, dependencyString) {
            const functionString = fn.toString()
            const args = functionString.substring(functionString.indexOf("(") + 1, functionString.indexOf(")"))
            const content = functionString.substring(functionString.indexOf("{") + 1, functionString.lastIndexOf("}"))
            const code = `
            const { workerData, parentPort } = require("worker_threads")
            
            ${dependencyString}
            
            function execute(${args}) {
                ${content}
            }
            parentPort.on("message", async (params) => {
                let result = []
                for(let i = 0; i < params.length; i++) {
                    result.push(execute(...params[i]))
                }
                for(let i = 0; i < params.length; i++)
                if(result[i] instanceof Promise) {
                    result[i] = await result[i]
                }
                parentPort.postMessage(result)
            })
            `
            const worker = new this.Worker(code, { eval: true })
            const workerInterface = {
                //This will be assigned by the threadplanner at a later time
                onmessage: () => { },
                //This will be assigned by the threadplanner at a later time
                onerror: () => { },
                postMessage: (...args) => worker.postMessage(...args),
                terminate: () => worker.terminate()
            }
            worker.on("message", (message) => workerInterface.onmessage({ data: message }))
            worker.on("error", (...args) => workerInterface.onerror(...args))
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

    /**
     * Executes the function in a separate thread.
     */
    Function.prototype.runThread = function (...args) {
        return threadPlanner.run(this, [...args]).then(result => result[0])
    }

    /**
     * Executes the function in a separate thread multiple times with different arguments. Returns an array of results.
     * E.g. fn.runManyInThread([arg1, arg2], [arg1, arg2])
     * -> [Result1, Result2]
     * @param args Arguments for the function passed as arrays.
     */
    Function.prototype.runManyInThread = function (...args) {
        return threadPlanner.run(this, ...args)
    }

    /**
     * Terminates all running threads for the function.
     */
    Function.prototype.terminateThreads = function () {
        threadPlanner.terminate(this)
    }

    /**
     * Returns the maximum number of estimated threads that can be executed in parallel on this host.
     */
    Function.prototype.getMaxThreadCount = function () {
        return threadPlanner.getMaxThreadCount()
    }

    /**
     * Sets the maximum number of threads that can be executed in parallel on the host.
     */
    Function.prototype.setMaxThreadCount = function (maxThreadCount) {
        return threadPlanner.setMaxThreadCount(maxThreadCount)
    }

    /**
     * Sets the maximum time (in ms) that a thread can be idle before being terminated automatically. 
     * If set to 0 threads will never terminate.
     */
    Function.prototype.setThreadMaxIdleTime = function (maxIdleTime) {
        return threadPlanner.setThreadMaxIdleTime(maxIdleTime)
    }

})()