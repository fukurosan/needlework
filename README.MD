# Needlework
Needlework is compact, super simple library that enables effortless multi threading in JavaScript. Needlework prioritizes absolute simplicity and automation above all else. What this means is that you don't need to know much about how JavaScript's so called workers actually work, manage the number of simultaneously running threads running, nor termination of threads after execution completes.

Needlework works in all evergreen browsers as well as any NodeJS version with support for worker_threads.

# How to
Needlework enhances the built-in Function prototype in your JavaScript project by attaching a series of new functions that are internally managed by Needlwork. This means that you do not need to deal with creating worker objects, terminating workers after execution, nor do you need to keep track of how many threads are running at any given point in time. It is all handled for you. 

After importing Needlework a function called "runThread" will be attached to the Function prototype, and can be accessed via any JavaScript function. Executing the runThread function will run the function in a separate thread, and return a promise that will either resolve with the result from the function, or reject with an error.

Check out this example:
```javascript
import "needlework"

function heavyWork(numberOne, numberTwo) {
    const start = Date.now()
    while(start + 500 > Date.now()) {}
    return numberOne + numberTwo
}

let resultPromises = []
for(let i = 0; i < 10; i++) {
    resultPromises.push(heavyWork.runThread(i, i))
}
Promise.all(resultPromises).then(results => {
    console.log(results) // -> [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
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

If your function returns a promise (for example if it is an async function) then Needlework will understand this and forward the resolved/rejected result of the function as the result of the threaded function.

Needlework will furthermore make sure that the total amount of concurrent threads never exceeds the amount of logical processors (-1 for headroom) on the system. This means that if for example your system's CPU has 12 logical cores then no more than 11 simultaneous threads can run. The rest will be put into a queue and execute after previous ones complete. 

# How it works
When you run a function as a thread Needlwork will internally create workers to accomodate the requests. When this happens your function will be serialized into a string, and deserialized/executed inside of the Worker. After execution has finished Needlework waits for new requests for a total of 10 seconds before finally terminating the workers. The reason for this is that creating a Worker is a fairly expensive operation, and reusing workers is a way of negating this cost. If the function is executed again within the 10 seconds waiting time the already existing worker can be reused, and the timer restarts. All this happens in the background without you having to think about it.

# Caveats
Needlework is limited by the nature of JavaScript multi-threading and workers. When a function is executed in a separate thread it will be serialized, and any references to memory stored in the main thread will be unavailable. 

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
