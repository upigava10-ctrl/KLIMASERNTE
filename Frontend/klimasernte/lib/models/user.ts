export interface User {
  uuid: string;
  nombre: string;
  producerSize: string | null;
  email: string;
  isFarmer: boolean;
  created_at: string;
  updated_at: string;
  apellido_p: string;
  apellido_m: string;
  active_u: boolean;
}