export class ApiError extends Error {
  constructor(status,code,message,extra){super(message);this.status=status;this.code=code;this.extra=extra;}
}
export function requireThat(condition,status,code,message){if(!condition)throw new ApiError(status,code,message);}
export const bad=message=>new ApiError(400,'invalid_request',message);
export const forbidden=message=>new ApiError(403,'forbidden',message||'This action belongs to the other member.');
