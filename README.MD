# Needlework
Needlework is a compact library that enables effortless multi-threading in JavaScript by extending and enhancing the built-in Function prototype.

Needlework works in all evergreen browsers as well as any NodeJS version with support for worker_threads.

Try it out!
```bash
npm install needlework
```

# How to
Needlework enhances the built-in Function prototype in your JavaScript project by attaching a series of new functions that are internally managed by Needlework. This means that you do not need to deal with creating worker objects, terminating workers after execution, nor do you need to keep track of how many threads are running at any given point in time. This is instead all handled for you.

After importing Needlework a function called "runThread" will be attached to the Function prototype, and can be accessed via any JavaScript function. Executing the runThread function will run the function in a separate thread, and return a promise that will either resolve with the result from the function, or reject with an error.

Check out this example:
```javascript
import "needlework"

function heavyWork(numberOne, numberTwo) {
    return numberOne + numberTwo
}

//Execute in main thread (blocking)
console.log(heavyWork(1, 2))

//Execute in separate thread (non-blocking)
heavyWork.runThread(1, 2).then(result => {
    console.log(result) // -> 3
})
```

You can also import it using a script-element:
```html
<script src="https://unpkg.com/needlework"></script>
```

Or using require
```javascript
require("needlework")
```

If your function returns a promise (e.g. if it is an async function) then Needlework will understand this and the thread will resolve/reject according to the result of the promise from the function.

Needlework will furthermore make sure that the total amount of concurrent threads never exceeds the amount of logical processors (-1 for headroom) on the system. This means that if for example your system's CPU has 12 logical cores then no more than 11 simultaneous threads will be executed. Any additional threads will be put into a queue and execute after previous ones have completed. 

# How it works
When you run a function as a thread Needlework will internally create workers to accomodate the requests. When this happens your function will be serialized into a string, and deserialized/executed inside of the Worker. After execution has finished Needlework waits for new requests for a total of 10 seconds before finally terminating the workers. The reason for this is that creating a Worker is a fairly expensive operation, and reusing workers is a way of negating this cost. If the function is executed again within the 10 seconds waiting time the already existing worker can be reused, and the timer restarts. All this happens in the background without you having to think about it.

# Function Dependencies
Needlework is limited by the nature of JavaScript multi-threading and workers. When a function is executed in a separate thread it will be serialized, and therefore any references to memory stored in the main thread will be unavailable. 

For example:

```javascript
import "needlework"

var someVariable = {
    something: 0
}
function doSomething() {
    return someVariable.something 
}
doSomething.runThread() //This will not work, because "someVariable" will be undefined in the new thread.
```

Needlework deals with this problem by allowing you to define dependencies for your functions. This can be done either as a string, or as an object. Dependencies will be evaluated recursively, so you can have a function as a dependency that in turn has other dependencies. 
Note that dependencies will not update once the thread has been created. The only way to update them is to terminate all running threads, and then run a new thread. This is super-not-recommended.
```javascript
import "needlework"

var someVariable = {
    something: 1
}
function doSomething() {
    return someVariable.something + someOtherVariable 
}

doSomething._needlework = {
    //A dependency string is essentially just a snippet of JavaScript as a string. This will execute first of all when the worker loads
    dependencyString: "const someOtherVariable = 2"
    //Dependencies are named dependencies that will be parsed into strings. You can even map functions here.
    dependencies: {
        //The below results in:
        //var someVariable = { something: 1 }
        [someVariable.name]: someVariable
    },
}

//This will now work, because the dependencies are mapped
doSomething.runThread() // -> 2
```

Note the syntax "[someVariable.name]: someVariable" that is used instead of "someVariable: someVariable". It is recommended to use the above syntax, because it stops you from running into strange errors with minifiers that mangle your function names, and inadvertantly end up breaking your depdency tree.

# Execute a function many times (with better performance)
If you need to execute a function many times then you can potentially speed it up by passing all execution arguments simultaneously.

Consider the below example:
```javascript
const someFunction = (arg1, arg2) {
    return arg1 + arg2
}
//This
Promise.all(
    someFunction.runThread(1, 1),
    someFunction.runThread(1, 1),
    someFunction.runThread(1, 1),
).then(results => {
    results // -> [2, 2, 2]
})
//Is equal to this
someFunction.runManyInThread([1, 1], [1, 1], [1, 1]).then(results => {
    results // -> [2, 2, 2]
})
```
Executing your function in the second way will often result in better performance. This is because it negates the cost of posting several messages between threads, by instead allowing needlework to post all information in one go.

# Thread Termination
Threads will terminate automatically, but you can also terminate all threads for a given function manually like so:
```javascript
const myFn = () => {}
myFn.runThread()
//This will forcefully terminate the above thread, which will result in a rejected promise
myFn.terminateThreads()
```

If you want, you can also set the allowed idle time before threads are automatically terminated. If you set this to 0 threads will never automatically terminate. Note that this can cause memory leaks, so in that case it is up to you to ensure that workers are terminated when necessary.

```javascript
Function.prototype.setThreadMaxIdleTime(60000) //60 000ms, 60s
```

# Max thread count
Needlework computes an estimated max thread count. This is sometimes useful ti know when writing algorithms where you want to process information in batches. Needlework will never execute more threads in parallel than the max thread count.
```javascript
Function.prototype.getMaxThreadCount()
```

You can also manually override the maximum thread count:
```javascript
Function.prototype.setMaxThreadCount(2) //No more than two threads will ever run in parallel
```
