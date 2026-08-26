import TaskQueue from "../taskqueue.js";
import { Sleep } from "../utils.js";

let taskqueue = new TaskQueue();

console.log("Test started at :", new Date().getTime());

// Test 1::::
// let result1 = await taskqueue.addTask(async function () {
//   await Sleep(1000);
//   return [new Date().getTime(), null];
// });
// console.log(new Date().getTime(), "Task 1 Done", result1);

// let result2 = await taskqueue.addTask(async function () {
//   await Sleep(2000);
//   return [new Date().getTime(), null];
// });
// console.log(new Date().getTime(), "Task 2 Done", result2);

// let result3 = await taskqueue.addTask(async function () {
//   await Sleep(1000);
//   return [new Date().getTime(), null];
// });
// console.log(new Date().getTime(), "Task 3 Done", result3);

// Test 2::::

async function runTest2() {
  taskqueue
    .addTask(async function () {
      await Sleep(1000);
    })
    .then(async () => {
      console.log(new Date().getTime(), "Task 1 Done");
      await Sleep(1000);
      console.log(new Date().getTime(), "Task 1 Done After sleep");
    });

  taskqueue
    .addTask(async function () {
      await Sleep(2000);
    })
    .then(async () => {
      console.log(new Date().getTime(), "Task 2 Done");
      await Sleep(2000);
      console.log(new Date().getTime(), "Task 2 Done After sleep");
    });

  taskqueue
    .addTask(async function () {
      await Sleep(1000);
    })
    .then(async () => {
      console.log(new Date().getTime(), "Task 3 Done");
      await Sleep(1000);
      console.log(new Date().getTime(), "Task 3 Done After sleep");
    });

  await Sleep(10000);
}

await runTest2();
