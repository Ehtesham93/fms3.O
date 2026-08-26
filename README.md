# Nemo FMS

<h2>Nomenclature:</h2>

<b>User Type:</b> <i>Null. A single user can use the application as platform user, regular user. so, roles define the user's identity, not type. this is added to protect from any unforeseen future usecases.</i>

<b>Account Types:</b> <i>platform, customer</i>

<b>Module Types:</b> <i>platform (console is one of the modules in platform), api, fms</i>

<b>SSO Types:</b> <i>EMAIL_PWD, MOBILE</i>

<b>Role Types:</b> <i>platform, account</i>

<b>Package Types:</b> <i>default, custom</i>

<b>Package Categories:</b> <i>mobile, fms, api</i>

<h2>Seeded Data:</h2>

<b>Seed User Id:</b> <i>ffffffff-ffff-ffff-ffff-ffffffffffff</i> (exists in users table as disabled user)
<b>Platform Account Id:</b> <i>ffffffff-ffff-ffff-ffff-ffffffffffff</i>
<b>Platform Fleet Id:</b> <i>ffffffff-ffff-ffff-ffff-ffffffffffff</i>

"all.all.all" as permid is seeded

<h2>Default Data:</h2>

<b>Root Fleet Id:</b> <i>ffffffff-ffff-ffff-ffff-ffffffffffff</i>
<b>Root Fleet Name:</b> <i>HOME</i>

Module Permissions:

Console Module:

1. console.modules.read
2. console.moduletypes.read
3. console.module.create
4. console.module.update
5. console.module.delete
6. console.moduleperms.read
7. console.moduleperm.create
8. console.moduleperm.update
9. console.moduleperm.delete
10. console.packages.read
11. console.package.create
12. console.package.update
13. console.package.delete
14. console.packagemodules.update
15. console.packagemodules.read
16. console.packagetypes.read
17. console.roles.read
18. console.role.create
19. console.role.update
20. console.role.delete
21. console.rolemodules.read
22. console.rolemoduleperms.read
23. console.rolemoduleperms.update
24. console.administrators.read
25. console.administrator.read
26. console.administrator.invite
27. console.administrator.update
28. console.administratorroles.read
29. console.administratorrole.assign
30. console.administratorrole.unassign
31. console.users.read
32. console.users.search
33. console.accounts.read
34. console.account.create
35. console.accountinfo.update
36. console.accountusers.read
37. console.accountusers.invites
38. console.accountpackages.read
39. console.accountpackage.addtoaccount
40. console.accountpackage.removefromaccount
41. console.accountassignedpkg.read
42. console.accountassignedpkg.update
43. console.accountassignedpkghistory.read
44. console.accountvehicles.read
45. console.accountvehicle.subscribe
46. console.accountvehicle.unsubscribe
47. console.accountvehicle.update
48. console.accountvehicle.search
49. console.accountcredits.read
50. console.accountcredits.update
51. console.accountcredits.history
52. console.accountcredits.history.read
53. console.accountcredits.history.update
54. console.accountcredits.history.delete
55. console.accountcredits.history.create
56. console.accountcredits.history.read
57. console.accountcredits.history.update
58. console.accountcredits.history.delete

Service Module:

1. service.overview.dashboard
2. service.overview.vehicles
3. service.overview.vehicleinfo
4. service.overview.searchveh
5. service.overview.bookservice
6. service.overview.rsa
7. service.overview.estimate
8. service.overview.servicetypes
9. service.dealers.search
10. service.dealers.dealerinfo

Live Tracking Module:

1. livetracking.overview.dashboard
2. livetracking.overview.mapview
3. livetracking.overview.vehinfo
4. livetracking.overview.searchveh
5. livetracking.overview.realtime

Account Management Module:

1. account.users.read
2. account.users.invite
3. account.user.read
4. account.user.update
5. account.user.delete
6. account.userrole.assign
7. account.userrole.read
8. account.userrole.unassign
9. account.roles.read
10. account.role.create
11. account.role.update
12. account.role.delete
13. account.rolemoduleperms.read
14. account.rolemoduleperms.update
15. account.fleet.info
16. account.fleets.read
17. account.fleet.create
18. account.fleet.update


